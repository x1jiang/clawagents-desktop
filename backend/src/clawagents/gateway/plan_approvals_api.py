"""Plan-approval waiter registry + HTTP resolve endpoint (exit_plan_mode)."""

from __future__ import annotations

import asyncio
import uuid
from typing import Literal, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from clawagents.gateway.desktop_router import require_auth

router = APIRouter(tags=["plan-approvals"], dependencies=[require_auth()])

PlanDecision = Literal["approve", "request_changes", "reject"]
_PendingEntry = Union[None, "asyncio.Future[PlanDecision]", str]


class PlanApprovalWaiterRegistry:
    def __init__(self) -> None:
        self._pending: dict[str, _PendingEntry] = {}
        self._loops: dict[str, asyncio.AbstractEventLoop] = {}
        self._comments: dict[str, str] = {}

    def create(self) -> str:
        request_id = uuid.uuid4().hex
        self._pending[request_id] = None
        return request_id

    async def wait(self, request_id: str, *, timeout: float) -> tuple[PlanDecision, str]:
        loop = asyncio.get_running_loop()
        entry = self._pending.get(request_id)

        if isinstance(entry, str):
            self._pending.pop(request_id, None)
            comment = self._comments.pop(request_id, "")
            return entry, comment  # type: ignore[return-value]

        if entry is None:
            fut: asyncio.Future[PlanDecision] = loop.create_future()
            self._pending[request_id] = fut
            self._loops[request_id] = loop
        else:
            fut = entry

        try:
            decision = await asyncio.wait_for(fut, timeout=timeout)
            comment = self._comments.pop(request_id, "")
            return decision, comment
        finally:
            self._pending.pop(request_id, None)
            self._loops.pop(request_id, None)
            self._comments.pop(request_id, None)

    def resolve(
        self,
        request_id: str,
        decision: PlanDecision,
        *,
        comment: str = "",
    ) -> None:
        if request_id not in self._pending:
            return
        if comment:
            self._comments[request_id] = comment
        entry = self._pending.get(request_id)
        if entry is None or isinstance(entry, str):
            self._pending[request_id] = decision  # type: ignore[assignment]
            return
        fut = entry
        if fut.done():
            return
        loop = self._loops.get(request_id)
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(_safe_set_result, fut, decision)
        else:
            try:
                fut.set_result(decision)
            except asyncio.InvalidStateError:
                pass


def _safe_set_result(fut: "asyncio.Future[PlanDecision]", value: PlanDecision) -> None:
    if not fut.done():
        fut.set_result(value)


_registry = PlanApprovalWaiterRegistry()


def get_plan_registry() -> PlanApprovalWaiterRegistry:
    return _registry


class PlanDecisionBody(BaseModel):
    decision: PlanDecision
    comment: str = ""


@router.post("/plan-approvals/{request_id}")
def post_plan_decision(request_id: str, body: PlanDecisionBody) -> dict:
    if request_id not in _registry._pending:
        raise HTTPException(status_code=404, detail=f"unknown request {request_id}")
    _registry.resolve(request_id, body.decision, comment=body.comment or "")
    return {"ok": True, "decision": body.decision, "comment": body.comment}
