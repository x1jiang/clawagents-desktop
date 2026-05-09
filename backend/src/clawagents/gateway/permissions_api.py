"""Permission decision endpoint + in-process waiter registry.

The streaming chat handler (Task 13) emits a `permission_required` SSE event
with a fresh request_id, registers a future in the registry, and awaits it.
The UI POSTs the user's decision here, which resolves the future, and the
agent loop continues or aborts.

Concurrency model:
- A pending entry is one of three states: ``None`` (registered but not yet
  awaited), ``asyncio.Future`` (someone is awaiting), or a stored
  ``Decision`` string (resolve fired before wait).
- ``resolve()`` is called from the FastAPI threadpool; ``wait()`` runs on
  the asyncio loop. Cross-thread future resolution uses
  ``loop.call_soon_threadsafe`` to stay safe.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Literal, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["permissions"], dependencies=[require_auth()])

Decision = Literal["allow_once", "allow_always", "deny"]

# Pending entry states:
#   None — created but no waiter yet
#   asyncio.Future — a waiter is awaiting
#   str (Decision) — resolved before wait was called; wait will fast-return it
_PendingEntry = Union[None, "asyncio.Future[Decision]", str]


class PermissionWaiterRegistry:
    """In-process registry of pending permission requests.

    Single-process / single-event-loop. No multi-worker support — gateway
    runs as a single uvicorn worker for desktop use.
    """

    def __init__(self) -> None:
        self._pending: dict[str, _PendingEntry] = {}
        # Loop the future lives on, captured at wait() time. resolve() (which
        # runs on a threadpool thread) uses this to dispatch set_result safely.
        self._loops: dict[str, asyncio.AbstractEventLoop] = {}

    def create(self) -> str:
        request_id = uuid.uuid4().hex
        self._pending[request_id] = None
        return request_id

    async def wait(self, request_id: str, *, timeout: float) -> Decision:
        loop = asyncio.get_running_loop()
        entry = self._pending.get(request_id)

        # Fast-path: resolve() fired before wait() was called.
        if isinstance(entry, str):
            self._pending.pop(request_id, None)
            return entry  # type: ignore[return-value]

        if entry is None:
            fut: asyncio.Future[Decision] = loop.create_future()
            self._pending[request_id] = fut
            self._loops[request_id] = loop
        else:
            fut = entry  # already a future (e.g. parallel waits — unusual)

        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            # Clean up in all paths: success, timeout, cancelled.
            self._pending.pop(request_id, None)
            self._loops.pop(request_id, None)

    def resolve(self, request_id: str, decision: Decision) -> None:
        entry = self._pending.get(request_id)
        if request_id not in self._pending:
            return  # truly unknown id (or already cleaned up)

        if entry is None:
            # resolve() raced ahead of wait(). Stash the decision so the
            # eventual wait() returns it immediately.
            self._pending[request_id] = decision  # type: ignore[assignment]
            return

        if isinstance(entry, str):
            # Already resolved — silently overwrite is harmless.
            self._pending[request_id] = decision  # type: ignore[assignment]
            return

        # entry is a Future. Hand the result back to the loop the future
        # was created on (cross-thread-safe).
        fut = entry
        if fut.done():
            return
        loop = self._loops.get(request_id)
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(_safe_set_result, fut, decision)
        else:
            # Same-thread / loop-not-running fallback (test environments).
            try:
                fut.set_result(decision)
            except asyncio.InvalidStateError:
                pass


def _safe_set_result(fut: "asyncio.Future[Decision]", value: Decision) -> None:
    if not fut.done():
        fut.set_result(value)


_registry = PermissionWaiterRegistry()


def get_registry() -> PermissionWaiterRegistry:
    return _registry


class DecisionBody(BaseModel):
    decision: Decision


@router.post("/permissions/{request_id}")
def post_decision(request_id: str, body: DecisionBody) -> dict:
    if request_id not in _registry._pending:
        raise HTTPException(status_code=404, detail=f"unknown request {request_id}")
    _registry.resolve(request_id, body.decision)
    return {"ok": True}
