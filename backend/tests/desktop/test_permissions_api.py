"""Permission decision endpoint resolves an awaiting future."""

from __future__ import annotations

import asyncio
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.permissions_api import (
    PermissionWaiterRegistry,
    router as permissions_router,
)


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(permissions_router)
    return TestClient(app)


@pytest.mark.asyncio
async def test_register_and_resolve_returns_decision() -> None:
    reg = PermissionWaiterRegistry()
    request_id = reg.create()

    async def resolver():
        await asyncio.sleep(0.01)
        reg.resolve(request_id, "allow_once")

    asyncio.create_task(resolver())
    decision = await reg.wait(request_id, timeout=1.0)
    assert decision == "allow_once"


@pytest.mark.asyncio
async def test_resolve_unknown_request_id_is_noop() -> None:
    reg = PermissionWaiterRegistry()
    reg.resolve("unknown", "deny")  # must not raise


@pytest.mark.asyncio
async def test_wait_times_out() -> None:
    reg = PermissionWaiterRegistry()
    rid = reg.create()
    with pytest.raises(asyncio.TimeoutError):
        await reg.wait(rid, timeout=0.05)


@pytest.mark.asyncio
async def test_wait_cleans_up_on_timeout() -> None:
    """Memory hygiene: timed-out entries must not linger in the registry."""
    reg = PermissionWaiterRegistry()
    rid = reg.create()
    with pytest.raises(asyncio.TimeoutError):
        await reg.wait(rid, timeout=0.01)
    assert rid not in reg._pending
    assert rid not in reg._loops


@pytest.mark.asyncio
async def test_resolve_before_wait_returns_decision() -> None:
    """Race fix: resolve() before wait() must stash the decision so
    wait() returns it immediately rather than hanging."""
    reg = PermissionWaiterRegistry()
    rid = reg.create()
    reg.resolve(rid, "allow_always")
    decision = await reg.wait(rid, timeout=0.5)
    assert decision == "allow_always"
    assert rid not in reg._pending


def test_post_decision_resolves_pending(client: TestClient) -> None:
    """End-to-end via the HTTP route: queue a request, POST a decision,
    confirm the registry's wait() resolves."""
    from clawagents.gateway.permissions_api import _registry

    rid = _registry.create()

    decision_task: list[str] = []

    async def _runner():
        decision_task.append(await _registry.wait(rid, timeout=2.0))

    loop = asyncio.new_event_loop()
    t = threading.Thread(target=lambda: loop.run_until_complete(_runner()))
    t.start()

    # Tiny sleep to let the runner thread enter wait()
    import time
    time.sleep(0.05)

    # POST the decision via HTTP
    r = client.post(f"/permissions/{rid}", json={"decision": "deny"})
    assert r.status_code == 200

    t.join(timeout=3.0)
    assert decision_task == ["deny"]
