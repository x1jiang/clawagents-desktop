import base64
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clawagents.gateway.attachments_api import router


@pytest.fixture()
def client(app_support_dir: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("GATEWAY_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def test_upload_text_attachment_extracts_preview(client: TestClient, app_support_dir: Path) -> None:
    r = client.post(
        "/chats/chat-1/attachments",
        json={
            "filename": "notes.txt",
            "mime_type": "text/plain",
            "data_base64": _b64(b"hello upload"),
        },
    )

    assert r.status_code == 201
    body = r.json()
    assert body["filename"] == "notes.txt"
    assert body["kind"] == "text"
    assert body["text_preview"] == "hello upload"
    assert body["checksum"].startswith("sha256:")
    assert body["chunks_count"] == 1
    assert body["warnings"] == []
    assert Path(body["path"]).read_text() == "hello upload"
    assert Path(body["path"]).is_relative_to(app_support_dir)


def test_upload_docx_extracts_document_xml(client: TestClient) -> None:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "word/document.xml",
            "<w:document xmlns:w='urn'><w:body><w:p><w:r><w:t>Quarterly plan</w:t></w:r></w:p></w:body></w:document>",
        )

    r = client.post(
        "/chats/chat-1/attachments",
        json={
            "filename": "plan.docx",
            "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "data_base64": _b64(buf.getvalue()),
        },
    )

    assert r.status_code == 201
    assert r.json()["kind"] == "document"
    assert "Quarterly plan" in r.json()["text_preview"]


def test_upload_rejects_unsupported_type(client: TestClient) -> None:
    r = client.post(
        "/chats/chat-1/attachments",
        json={
            "filename": "run.sh",
            "mime_type": "text/x-shellscript",
            "data_base64": _b64(b"rm -rf nope"),
        },
    )

    assert r.status_code == 415


def test_upload_dedupes_same_checksum_in_chat(client: TestClient) -> None:
    payload = {
        "filename": "dupe.txt",
        "mime_type": "text/plain",
        "data_base64": _b64(b"same bytes"),
    }

    first = client.post("/chats/chat-1/attachments", json=payload)
    second = client.post("/chats/chat-1/attachments", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["deduped"] is True
    listed = client.get("/chats/chat-1/attachments")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [first.json()["id"]]


def test_search_returns_relevant_attachment_chunks(client: TestClient) -> None:
    text = ("alpha " * 900) + "budget forecast needle " + ("omega " * 900)
    uploaded = client.post(
        "/chats/chat-1/attachments",
        json={"filename": "long.txt", "mime_type": "text/plain", "data_base64": _b64(text.encode())},
    )

    assert uploaded.status_code == 201
    assert uploaded.json()["chunks_count"] > 1
    r = client.post("/chats/chat-1/attachments/search", json={"query": "budget needle", "limit": 2})

    assert r.status_code == 200
    chunks = r.json()["chunks"]
    assert chunks
    assert chunks[0]["attachment_id"] == uploaded.json()["id"]
    assert "budget forecast needle" in chunks[0]["text"]


def test_search_finds_text_beyond_preview_limit(client: TestClient) -> None:
    text = ("prefix " * 5000) + "deepneedle after preview"
    uploaded = client.post(
        "/chats/chat-1/attachments",
        json={"filename": "beyond.txt", "mime_type": "text/plain", "data_base64": _b64(text.encode())},
    )

    assert uploaded.status_code == 201
    assert uploaded.json()["text_truncated"] is True
    r = client.post("/chats/chat-1/attachments/search", json={"query": "deepneedle", "limit": 1})

    assert r.status_code == 200
    assert "deepneedle after preview" in r.json()["chunks"][0]["text"]


def test_download_and_delete_attachment(client: TestClient) -> None:
    uploaded = client.post(
        "/chats/chat-1/attachments",
        json={"filename": "delete-me.txt", "mime_type": "text/plain", "data_base64": _b64(b"delete me")},
    ).json()

    download = client.get(f"/chats/chat-1/attachments/{uploaded['id']}/download")
    assert download.status_code == 200
    assert download.content == b"delete me"

    deleted = client.delete(f"/chats/chat-1/attachments/{uploaded['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True
    assert not Path(uploaded["path"]).exists()
    assert client.get(f"/chats/chat-1/attachments/{uploaded['id']}/download").status_code == 404
    assert client.get("/chats/chat-1/attachments").json() == []


def test_rejects_image_extension_with_non_image_bytes(client: TestClient) -> None:
    r = client.post(
        "/chats/chat-1/attachments",
        json={"filename": "fake.png", "mime_type": "image/png", "data_base64": _b64(b"not an image")},
    )

    assert r.status_code == 415
    assert "does not match" in r.json()["detail"]


def test_detected_image_mime_overrides_same_family_declaration(client: TestClient) -> None:
    r = client.post(
        "/chats/chat-1/attachments",
        json={
            "filename": "camera.png",
            "mime_type": "image/png",
            "data_base64": _b64(b"\xff\xd8\xff\xe0" + b"jpeg payload"),
        },
    )

    assert r.status_code == 201
    assert r.json()["mime_type"] == "image/jpeg"
    assert any("detected image/jpeg" in warning for warning in r.json()["warnings"])


def test_detected_text_mime_overrides_active_content_declaration(client: TestClient) -> None:
    r = client.post(
        "/chats/chat-1/attachments",
        json={
            "filename": "notes.txt",
            "mime_type": "text/html",
            "data_base64": _b64(b"plain notes"),
        },
    )

    assert r.status_code == 201
    assert r.json()["mime_type"] == "text/plain"
    assert any("detected text/plain" in warning for warning in r.json()["warnings"])


def test_upload_xlsx_extracts_rows(client: TestClient) -> None:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("xl/sharedStrings.xml", "<sst><si><t>Name</t></si><si><t>Total</t></si></sst>")
        zf.writestr(
            "xl/worksheets/sheet1.xml",
            """
            <worksheet>
              <sheetData>
                <row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>
                <row><c><v>Q1</v></c><c><v>42</v></c></row>
              </sheetData>
            </worksheet>
            """,
        )

    r = client.post(
        "/chats/chat-1/attachments",
        json={
            "filename": "table.xlsx",
            "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "data_base64": _b64(buf.getvalue()),
        },
    )

    assert r.status_code == 201
    assert "Name\tTotal" in r.json()["text_preview"]
    assert "Q1\t42" in r.json()["text_preview"]


def test_upload_pptx_extracts_speaker_notes(client: TestClient) -> None:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("ppt/slides/slide1.xml", "<p:sld><a:t>Slide title</a:t></p:sld>")
        zf.writestr("ppt/notesSlides/notesSlide1.xml", "<p:notes><a:t>Speaker note detail</a:t></p:notes>")

    r = client.post(
        "/chats/chat-1/attachments",
        json={
            "filename": "slides.pptx",
            "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "data_base64": _b64(buf.getvalue()),
        },
    )

    assert r.status_code == 201
    assert "Slide title" in r.json()["text_preview"]
    assert "Speaker note detail" in r.json()["text_preview"]
