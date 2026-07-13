"""End-to-end: launch a real gateway, hit it with httpx, verify lifecycle."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.mark.timeout(30)
def test_gateway_smoke(app_support_dir: Path, tmp_path: Path) -> None:
    port = _free_port()
    # The subprocess bypasses pytest's ``pythonpath=["src"]`` config, so it
    # would otherwise import whatever ``clawagents`` is pip-installed (a stale
    # wheel from a sibling project, without the desktop routers). Force it to
    # load THIS backend's src so the smoke test is hermetic.
    backend_src = str(Path(__file__).resolve().parents[2] / "src")
    env = {
        **os.environ,
        "PYTHONPATH": backend_src + os.pathsep + os.environ.get("PYTHONPATH", ""),
        "GATEWAY_HOST": "127.0.0.1",
        "GATEWAY_API_KEY": "",  # no auth for the smoke test
        "CLAWAGENTS_DESKTOP_APP_SUPPORT": str(app_support_dir),
    }

    proc = subprocess.Popen(
        [sys.executable, "-m", "clawagents", "--serve", "--port", str(port)],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        # Wait until /health is up.
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                if httpx.get(f"http://127.0.0.1:{port}/health", timeout=1.0).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.25)
        else:
            pytest.fail(f"gateway did not start on :{port}")

        # Create a project, list it, list its chats, create one, fetch metadata.
        root = tmp_path / "proj"
        root.mkdir()
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5.0) as client:
            assert client.get("/projects").json() == []

            r = client.post("/projects", json={"name": "smoke", "root_path": str(root)})
            assert r.status_code == 201
            pid = r.json()["id"]

            assert [p["id"] for p in client.get("/projects").json()] == [pid]

            r = client.post(f"/projects/{pid}/chats", json={"title": "first", "model": "claude-opus-4-7", "mode": "auto"})
            assert r.status_code == 201
            cid = r.json()["chat_id"]

            chats = client.get(f"/projects/{pid}/chats").json()
            assert chats and chats[0]["id"] == cid

            assert client.get(f"/chats/{cid}").json()["title"] == "first"

            providers = client.get("/providers").json()
            assert any(p["id"] == "openai" for p in providers)

            assert client.delete(f"/chats/{cid}").status_code == 204
            assert client.delete(f"/projects/{pid}").status_code == 204
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
