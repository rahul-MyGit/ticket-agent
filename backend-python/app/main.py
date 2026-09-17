from __future__ import annotations

import os
import sys

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.state import reset_state, state


load_dotenv()

app = FastAPI(title="S30 AI Customer Support Agent", docs_url=None, redoc_url=None)


def success(data: object, status_code: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"success": True, "data": data})


def error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error": {"code": code, "message": message}},
    )


def evaluator_allowed(request: Request) -> bool:
    expected = os.getenv("EVALUATOR_RESET_TOKEN")
    supplied = request.headers.get("x-evaluator-token")
    return os.getenv("NODE_ENV") == "test" and bool(expected) and supplied == expected


@app.get("/health")
async def health() -> JSONResponse:
    return success({"status": "ok"})


@app.post("/__test/reset")
async def evaluator_reset(request: Request) -> JSONResponse:
    if not evaluator_allowed(request):
        return error(404, "NOT_FOUND", "Route not found")
    if not reset_state():
        return error(409, "RESET_BLOCKED", "State cannot be reset during an active agent run")
    return success({"status": "reset"})


@app.get("/__test/state")
async def evaluator_state(request: Request) -> JSONResponse:
    if not evaluator_allowed(request):
        return error(404, "NOT_FOUND", "Route not found")

    actions = [
        {
            key: action.get(key)
            for key in ("id", "ticketId", "orderId", "type", "status", "amount")
        }
        for action in state["actions"]
    ]
    approvals = [
        {
            key: approval.get(key)
            for key in ("id", "ticketId", "actionId", "decision")
        }
        for approval in state["approvals"]
    ]
    return success(
        {
            "inventory": state["inventory"],
            "actions": actions,
            "approvals": approvals,
        }
    )


# Students register the documented authentication and ticket routes here.


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=int(os.getenv("PORT", "3000")),
        reload="--reload" in sys.argv,
    )
