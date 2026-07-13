"""GET /commands lists user-defined slash commands from .md files."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.desktop_stores.app_paths import user_commands_dir
from clawagents.gateway.commands_api import router as commands_router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(commands_router)
    return TestClient(app)


def test_empty_dir(client: TestClient) -> None:
    assert client.get("/commands").json() == []


def test_parses_simple_md(client: TestClient) -> None:
    d = user_commands_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / "review.md").write_text("Please review the changes in src/.\n")
    cmds = client.get("/commands").json()
    assert len(cmds) == 1
    assert cmds[0]["name"] == "review"
    assert cmds[0]["body"] == "Please review the changes in src/."
    assert cmds[0]["description"] == "Custom command"


def test_parses_frontmatter_description(client: TestClient) -> None:
    d = user_commands_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / "tests.md").write_text(
        "---\ndescription: Run the full test suite and report failures\n---\n"
        "Run all tests and tell me which ones fail.\n"
    )
    cmds = client.get("/commands").json()
    assert cmds[0]["description"] == "Run the full test suite and report failures"
    assert cmds[0]["body"] == "Run all tests and tell me which ones fail."


def test_alphabetical_order(client: TestClient) -> None:
    d = user_commands_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / "zebra.md").write_text("z")
    (d / "alpha.md").write_text("a")
    (d / "middle.md").write_text("m")
    names = [c["name"] for c in client.get("/commands").json()]
    assert names == ["alpha", "middle", "zebra"]


def test_put_creates_command(client: TestClient) -> None:
    r = client.put("/commands/review", json={"description": "Review files", "body": "Review the changes in src/."})
    assert r.status_code == 200
    assert r.json()["name"] == "review"
    assert r.json()["description"] == "Review files"
    # Listing now includes it.
    names = [c["name"] for c in client.get("/commands").json()]
    assert "review" in names


def test_put_overwrites_existing(client: TestClient) -> None:
    client.put("/commands/test", json={"body": "first"})
    client.put("/commands/test", json={"body": "second"})
    cmd = next(c for c in client.get("/commands").json() if c["name"] == "test")
    assert cmd["body"] == "second"


def test_put_invalid_name(client: TestClient) -> None:
    assert client.put("/commands/UPPER", json={"body": "x"}).status_code == 400
    assert client.put("/commands/has spaces", json={"body": "x"}).status_code == 400
    assert client.put("/commands/", json={"body": "x"}).status_code in (404, 405)


def test_put_empty_body_rejected(client: TestClient) -> None:
    assert client.put("/commands/foo", json={"body": "   "}).status_code == 400


def test_delete_command(client: TestClient) -> None:
    client.put("/commands/gone", json={"body": "y"})
    r = client.delete("/commands/gone")
    assert r.status_code == 204
    assert not any(c["name"] == "gone" for c in client.get("/commands").json())


def test_delete_missing_404(client: TestClient) -> None:
    assert client.delete("/commands/nope").status_code == 404
