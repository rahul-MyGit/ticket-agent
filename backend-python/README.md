# S30 Contest — AI Customer Support Agent (Python)

## Overview

Build a FastAPI backend where customers create support tickets for order-related problems. A single
AI agent must investigate each ticket, call server-side tools, and either resolve the issue, request
more information, wait for support approval, or escalate it.

- Duration: 3 hours
- Build: Backend only
- Language: Python 3.12+
- Framework: FastAPI
- Server: Uvicorn
- Storage: Provided in-memory state
- Evaluator: Bun Test
- AI provider: Any real provider with tool/function calling

This must be a genuine multi-step tool-calling agent, not a one-call chatbot.

```text
Customer: My keyboard arrived damaged. Please replace it.

Agent → getOrder({ orderId: "ORD-1001" })
Agent → searchPolicies({ query: "damaged replacement" })
Agent → checkInventory({ productId: "PROD-KEYBOARD" })
Agent → createReplacement({ orderId: "ORD-1001", reason: "Arrived damaged" })
Agent → final response
```

## What the boilerplate provides

- FastAPI/Uvicorn setup in `app/main.py`
- Typed Python project configuration in `pyproject.toml`
- Seeded in-memory state in `app/state.py`
- Hashed passwords for seeded users
- `GET /health`
- Guarded evaluator reset and state-inspection endpoints
- Empty route, controller, middleware, agent, and tool packages
- The same black-box evaluator used by the TypeScript option

Do not change seeded IDs, prices, stock, ownership, policies, evaluator endpoints, or evaluator files.

## Setup

Install `uv` and Bun, then run:

```bash
cd backend-python
uv sync
bun install
cp .env.example .env
bun run dev
```

Configure `.env` with `PORT`, `JWT_SECRET`, and a real tool-capable provider/model. Never commit `.env`.

Required commands:

```bash
bun run dev
bun run start
bun test
```

The evaluator starts the server itself. Stop any manually started server before running `bun test`.

## Project structure

```text
backend-python/
├── app/
│   ├── main.py
│   ├── state.py
│   ├── routes/
│   ├── controllers/
│   ├── middleware/
│   ├── agent/
│   └── tools/
├── test/
├── package.json
├── pyproject.toml
└── .env.example
```

## In-memory state

Use the stable dictionary exported from `app.state`:

```python
from app.state import state

tickets = state["tickets"]
```

The state contains users, products, inventory, orders, policies, tickets, messages, agent runs, tool
calls, actions, approvals, and `activeRuns`. Data lasts only for the server process. Do not add a
database or filesystem persistence.

The boilerplate owns `POST /__test/reset` and `GET /__test/state`. They work only in test mode with an
evaluator token. Do not modify, call, or expose them from application code.

## Ticket status

```text
OPEN
PROCESSING
NEEDS_INFORMATION
AWAITING_APPROVAL
RESOLVED
ESCALATED
FAILED
```

Only `OPEN` tickets can run. `RESOLVED`, `ESCALATED`, and `FAILED` are terminal.

## Internal agent tools

Implement these as model-callable server functions, not HTTP routes:

```text
getOrder({ orderId })
getCustomerOrders({})
searchPolicies({ query })
checkInventory({ productId })
createReplacement({ orderId, reason })
createRefundRequest({ orderId, reason })
escalateToHuman({ reason })
```

The model selects tools, but Python code must validate arguments and enforce all authorization and
business rules.

## Business rules

- Tools may access only orders belonging to the ticket owner.
- Replacement requires `DELIVERED`, delivery within 7 days, and available stock.
- A successful replacement reduces stock exactly once.
- Refund requires `DELIVERED` and delivery within 30 days.
- Refunds up to and including ₹2,000 complete automatically.
- Refunds above ₹2,000 create one pending action and move the ticket to `AWAITING_APPROVAL`.
- An order may receive only one refund or replacement in total.
- Retrying the same action must return the existing action without repeating side effects.
- A different action for an order with an existing action must fail.
- Final duplicate/stock validation and mutations must be protected by an `asyncio.Lock` or another
  appropriate critical section.
- Persist every requested tool call, including invalid and failed calls.
- Never persist or return hidden model reasoning.

## Agent loop

- Set the ticket to `PROCESSING` before the first model request.
- Add its ID to `state["activeRuns"]` before awaiting the model.
- Allow at most 6 tool calls; failed calls count.
- Retry an identical failed call—same tool and arguments—at most once.
- If that call fails twice, escalate.
- Prevent simultaneous runs for the same ticket.
- Missing information may produce `NEEDS_INFORMATION` with a question.
- Provider failure sets `FAILED` and returns `502 MODEL_PROVIDER_ERROR`.
- A seventh tool call sets `FAILED` and returns `500 AGENT_STEP_LIMIT_EXCEEDED`.
- Remove the active-run marker in a `finally` block.

## Authentication

Use email/password login and JWT bearer authentication.

```text
Authorization: Bearer <token>
```

- Customers access only their tickets and orders.
- Support can view all tickets.
- Only customers create tickets.
- Only the ticket owner adds customer messages.
- Owner or support may run a ticket.
- Only support approves, rejects, or manually escalates.
- Missing/invalid authentication returns 401.
- Authenticated but forbidden access returns 403.

The supplied hashes are Argon2id and can be verified with `argon2.PasswordHasher`.

## Response contract

Every route returns JSON.

```json
{ "success": true, "data": {} }
```

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {}
  }
}
```

The evaluator allows flexibility for error bodies: it checks the documented HTTP status and valid
JSON, not exact error wording or keys. Successful response shapes and side effects remain strict.

Never return hashes, secrets, raw provider errors, prompts, stack traces, or chain-of-thought.

## Required routes

| Method | Route | Access |
| --- | --- | --- |
| GET | `/health` | Public |
| POST | `/api/auth/login` | Public |
| POST | `/api/tickets` | Customer |
| GET | `/api/tickets` | Customer/Support |
| GET | `/api/tickets/{ticketId}` | Owner/Support |
| POST | `/api/tickets/{ticketId}/messages` | Owner |
| POST | `/api/tickets/{ticketId}/run` | Owner/Support |
| POST | `/api/tickets/{ticketId}/approval` | Support |
| POST | `/api/tickets/{ticketId}/escalate` | Support |

Use the literal route names above. FastAPI `{ticketId}` corresponds to the documented HTTP path
parameter `:ticketId`.

## Validation and behavior

- Ticket subject: 5–120 trimmed characters.
- Initial ticket message: 10–2000 trimmed characters.
- Follow-up message: 1–2000 trimmed characters.
- Approval decision: `APPROVED` or `REJECTED`.
- Approval note: optional, maximum 500 characters.
- Escalation reason: 10–500 trimmed characters.
- Tickets sort newest first.
- Messages and tool calls sort oldest first.
- Follow-up information changes `NEEDS_INFORMATION` to `OPEN`.
- Manual escalation is allowed for `OPEN`, `NEEDS_INFORMATION`, and `AWAITING_APPROVAL`.
- Manual escalation rejects any pending action.
- Repeated approval/rejection returns 409.

Use unique IDs with these prefixes: `TKT-`, `MSG-`, `RUN-`, `TC-`, `ACT-`, and `APR-`. Use ISO 8601
timestamps.

## Seed users

| ID | Email | Password | Role |
| --- | --- | --- | --- |
| USR-CUSTOMER-1 | customer1@s30.test | password123 | CUSTOMER |
| USR-CUSTOMER-2 | customer2@s30.test | password123 | CUSTOMER |
| USR-SUPPORT-1 | support@s30.test | password123 | SUPPORT |

## Seed products

| ID | Product | Price | Stock |
| --- | --- | ---: | ---: |
| PROD-KEYBOARD | Mechanical Keyboard | ₹1,500 | 10 |
| PROD-HEADPHONES | Wireless Headphones | ₹4,999 | 5 |
| PROD-MOUSE | Wireless Mouse | ₹999 | 0 |

## Seed orders

| ID | Owner | Product | Status | Delivered |
| --- | --- | --- | --- | --- |
| ORD-1001 | Customer 1 | Keyboard | DELIVERED | 3 days ago |
| ORD-1002 | Customer 1 | Headphones | DELIVERED | 5 days ago |
| ORD-1003 | Customer 2 | Mouse | DELIVERED | 2 days ago |
| ORD-OLD-1 | Customer 1 | Keyboard | DELIVERED | 45 days ago |
| ORD-SHIPPED-1 | Customer 1 | Keyboard | SHIPPED | null |

## Evaluation priorities

1. Exact routes, success responses, and HTTP statuses
2. Authentication and customer-data isolation
3. Genuine multi-step model tool calling
4. Server-enforced business rules
5. Action and approval workflow
6. Atomicity, idempotency, and concurrency safety
7. Failure handling and secret protection

The real-model evaluator does not assert exact prose or an exact sequence of read-only tools. It checks
final state, side effects, ownership, persisted traces, and business invariants.
