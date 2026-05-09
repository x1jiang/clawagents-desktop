"""REST router for desktop Project CRUD."""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from clawagents.desktop_stores.permission_grant_store import PermissionGrantStore
from clawagents.desktop_stores.project_store import (
    ProjectNotFoundError,
    ProjectStore,
)
from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["projects"], dependencies=[require_auth()])


class ProjectCreateBody(BaseModel):
    name: str
    root_path: str
    default_model: str | None = None
    default_mode: str | None = None


class ProjectPatchBody(BaseModel):
    name: str | None = None
    default_model: str | None = None
    default_mode: str | None = None


@router.get("/projects")
def list_projects() -> list[dict]:
    return [asdict(p) for p in ProjectStore().list()]


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreateBody) -> dict:
    if not Path(body.root_path).exists():
        raise HTTPException(status_code=400, detail=f"root_path does not exist: {body.root_path}")
    p = ProjectStore().create(
        name=body.name,
        root_path=body.root_path,
        default_model=body.default_model,
        default_mode=body.default_mode,
    )
    return asdict(p)


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatchBody) -> dict:
    try:
        return asdict(ProjectStore().update(
            project_id,
            name=body.name,
            default_model=body.default_model,
            default_mode=body.default_mode,
        ))
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> Response:
    try:
        ProjectStore().delete(project_id)
    except ProjectNotFoundError:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")
    PermissionGrantStore().remove_for_project(project_id)
    return Response(status_code=204)
