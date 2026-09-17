# S30 Contest — AI Customer Support Agent

## Overview

Build an Express + TypeScript backend where customers create support tickets for order-related
problems. A single AI agent must investigate each ticket, call server-side tools, and either resolve
the issue, request more information, wait for support approval, or escalate it.

Duration: 3 hours  
Build: Backend only  
Runtime: Bun  
Framework: Express  
Language: TypeScript  
Storage: Provided in-memory state  
Tests: Bun Test

This must be a genuine tool-calling agent, not a one-call chatbot.

Example:

```text
Customer: My keyboard arrived damaged. Please replace it.

Agent → getOrder({ orderId: "ORD-1001" })
Agent → searchPolicies({ query: "damaged replacement" })
Agent → checkInventory({ productId: "PROD-KEYBOARD" })
Agent → createReplacement({ orderId: "ORD-1001", reason: "Arrived damaged" })
Agent → final response
```

## What the boilerplate provides

- Express server setup in `src/index.ts`
- `GET /health`
- Typed, seeded in-memory state in `src/state.ts`
- Hashed passwords for the seeded users
- Test-only state reset and inspection endpoints
- Evaluator tests in `test`
- `dev`, `start`, and `test` package scripts

Students must not change seeded IDs, prices, stock, order ownership, policies, evaluator endpoints, or
files inside `test`.

## Setup

```bash
cd backend
bun install
cp .env.example .env
bun run dev
```

Set a real AI key and model in `.env`:

```env
PORT=3000
JWT_SECRET=replace-me
OPENAI_API_KEY=replace-me
OPENAI_MODEL=replace-me
```

Required commands:

```bash
bun run dev
bun run start
bun test
```

## In-memory state

All application data must remain in the exported `state` object from `src/state.ts`. Data persists only
for the lifetime of the server process. Do not add PostgreSQL, SQLite, files, or another database.

Use the existing arrays for users, products, inventory, orders, policies, tickets, messages, agent
runs, tool calls, actions, and approvals. Use `state.activeRuns` for same-ticket run protection.

Always access collections through the state object, such as `state.tickets`. Do not retain a collection
reference across resets.

The boilerplate owns these evaluator-only routes:

- `POST /__test/reset`
- `GET /__test/state`

They are available only under `NODE_ENV=test` with the evaluator token. Do not modify, remove, call, or
expose these routes from application code.

## Ticket status

```ts
type TicketStatus =
  | "OPEN"
  | "PROCESSING"
  | "NEEDS_INFORMATION"
  | "AWAITING_APPROVAL"
  | "RESOLVED"
  | "ESCALATED"
  | "FAILED";
```

Only an `OPEN` ticket can run the agent. `RESOLVED`, `ESCALATED`, and `FAILED` are terminal.

## Agent tools

Implement these as server-side tools available to the model. They are not public HTTP routes.

```ts
getOrder({ orderId: string })
getCustomerOrders({})
searchPolicies({ query: string })
checkInventory({ productId: string })
createReplacement({ orderId: string, reason: string })
createRefundRequest({ orderId: string, reason: string })
escalateToHuman({ reason: string })
```

The model chooses tools, but tool implementations must enforce authorization and business rules. Never
trust the model to enforce them.

## Business rules

- Tools may access only orders belonging to the ticket owner.
- Replacement requires a delivered order, delivery within 7 days, and available stock.
- A successful replacement reduces stock by exactly one.
- Refund requires a delivered order and delivery within 30 days.
- Refunds up to and including ₹2,000 complete automatically.
- Refunds above ₹2,000 create one pending action and move the ticket to `AWAITING_APPROVAL`.
- An order can receive only one refund or replacement in total.
- Action tools must be atomic and idempotent.
- Validate all tool arguments.
- Persist every tool call, including arguments, result or safe error, status, and sequence number.
- Never store or return hidden chain-of-thought.

For an action mutation, perform the final duplicate/stock validation and mutation synchronously without
an `await` between them. Use an appropriate lock if your design introduces asynchronous work around the
critical section.

## Agent loop

- Change the ticket to `PROCESSING` before the first model call.
- Allow at most 6 tool calls per run.
- Retry a failed tool at most once. If the same tool fails twice, escalate.
- Prevent two runs from executing simultaneously for the same ticket.
- Missing information may produce `NEEDS_INFORMATION` with a clear question.
- Provider failure leaves the ticket as `FAILED` and returns `502 MODEL_PROVIDER_ERROR`.
- Exceeding the tool limit leaves the ticket as `FAILED` and returns
  `500 AGENT_STEP_LIMIT_EXCEEDED`.
- Remove the ticket ID from `state.activeRuns` in a `finally` block.

## Authentication and authorization

Use email/password login and JWT bearer authentication.

```ts
type UserRole = "CUSTOMER" | "SUPPORT";
```

Protected requests use:

```text
Authorization: Bearer <token>
```

- Customers access only their own tickets and orders.
- Support can view all tickets.
- Only support can approve, reject, or manually escalate.
- Missing or invalid token returns `401`.
- Authenticated but forbidden access returns `403`.
- Passwords in `state.ts` are Argon2id hashes. They can be checked with
  `await Bun.password.verify(password, user.passwordHash)`.

## Response contract

Every route returns JSON.

Success:

```json
{ "success": true, "data": {} }
```

Error:

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

`details` is optional. Never return secrets, password hashes, stack traces, internal prompts, or hidden
reasoning.

| Status | Usage |
| --- | --- |
| 200 | Successful read or action |
| 201 | Resource created |
| 400 | Invalid body or query |
| 401 | Missing or invalid authentication |
| 403 | Forbidden resource or action |
| 404 | Resource not found |
| 409 | Invalid state, duplicate, or concurrent run |
| 422 | Business rule rejected an action |
| 500 | Unexpected or agent-limit failure |
| 502 | AI provider failure |

## Required HTTP routes

Route names are exact.

| Method | Route | Access |
| --- | --- | --- |
| GET | `/health` | Public |
| POST | `/api/auth/login` | Public |
| POST | `/api/tickets` | Customer |
| GET | `/api/tickets` | Customer/Support |
| GET | `/api/tickets/:ticketId` | Owner/Support |
| POST | `/api/tickets/:ticketId/messages` | Owner |
| POST | `/api/tickets/:ticketId/run` | Owner/Support |
| POST | `/api/tickets/:ticketId/approval` | Support |
| POST | `/api/tickets/:ticketId/escalate` | Support |

### `GET /health`

```json
{ "success": true, "data": { "status": "ok" } }
```

### `POST /api/auth/login`

Request:

```json
{ "email": "customer1@s30.test", "password": "password123" }
```

Successful `data`:

```json
{
  "token": "<jwt>",
  "user": {
    "id": "USR-CUSTOMER-1",
    "name": "Aarav Customer",
    "email": "customer1@s30.test",
    "role": "CUSTOMER"
  }
}
```

Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`.

### `POST /api/tickets`

Request:

```json
{
  "orderId": "ORD-1001",
  "subject": "Keyboard arrived damaged",
  "message": "The keyboard arrived with broken keys. Please replace it."
}
```

`orderId` is optional. `subject` is 5–120 characters. `message` is 10–2000 characters.

Successful `data`:

```json
{
  "id": "TKT-<generated>",
  "customerId": "USR-CUSTOMER-1",
  "orderId": "ORD-1001",
  "subject": "Keyboard arrived damaged",
  "status": "OPEN",
  "createdAt": "<ISO timestamp>",
  "updatedAt": "<ISO timestamp>"
}
```

Errors: `400 VALIDATION_ERROR`, `404 ORDER_NOT_FOUND`, `403 ORDER_ACCESS_DENIED`.

### `GET /api/tickets?status=OPEN`

`status` is optional. Customers receive only their tickets; support receives all. Sort newest first.

```json
{ "success": true, "data": { "tickets": [] } }
```

Invalid status: `400 VALIDATION_ERROR`.

### `GET /api/tickets/:ticketId`

Successful `data`:

```json
{
  "ticket": {
    "id": "TKT-...",
    "customerId": "USR-CUSTOMER-1",
    "orderId": "ORD-1001",
    "subject": "Keyboard arrived damaged",
    "status": "RESOLVED",
    "finalResponse": "Your replacement has been created.",
    "escalationReason": null,
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>"
  },
  "messages": [],
  "toolCalls": [],
  "pendingAction": null
}
```

Messages and tool calls are oldest first. Errors: `404 TICKET_NOT_FOUND`,
`403 TICKET_ACCESS_DENIED`.

### `POST /api/tickets/:ticketId/messages`

```json
{ "content": "The order number is ORD-1001." }
```

Allowed in `OPEN` or `NEEDS_INFORMATION`. Adding information to `NEEDS_INFORMATION` changes it to
`OPEN`.

Successful `data`:

```json
{
  "message": {
    "id": "MSG-...",
    "role": "CUSTOMER",
    "content": "The order number is ORD-1001.",
    "createdAt": "<ISO timestamp>"
  },
  "ticketStatus": "OPEN"
}
```

Errors: `400 VALIDATION_ERROR`, `403 TICKET_ACCESS_DENIED`, `404 TICKET_NOT_FOUND`,
`409 INVALID_TICKET_STATE`.

### `POST /api/tickets/:ticketId/run`

No body is required. Only `OPEN` tickets can run.

Resolved response `data`:

```json
{
  "ticketId": "TKT-...",
  "status": "RESOLVED",
  "finalResponse": "A replacement was created.",
  "toolCallCount": 4,
  "pendingAction": null
}
```

High-value refund response `data`:

```json
{
  "ticketId": "TKT-...",
  "status": "AWAITING_APPROVAL",
  "finalResponse": "Your refund is waiting for support approval.",
  "toolCallCount": 3,
  "pendingAction": {
    "id": "ACT-...",
    "type": "REFUND",
    "status": "PENDING",
    "amount": 4999
  }
}
```

Errors: `403 TICKET_ACCESS_DENIED`, `404 TICKET_NOT_FOUND`, `409 INVALID_TICKET_STATE`,
`409 TICKET_ALREADY_PROCESSING`, `500 AGENT_STEP_LIMIT_EXCEEDED`, `502 MODEL_PROVIDER_ERROR`.

### `POST /api/tickets/:ticketId/approval`

Support only.

```json
{ "decision": "APPROVED", "note": "Checked and approved." }
```

`decision` must be `APPROVED` or `REJECTED`. Approval completes the refund and resolves the ticket.
Rejection marks the action rejected and escalates the ticket.

Errors: `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 TICKET_NOT_FOUND`,
`409 NO_PENDING_APPROVAL`.

### `POST /api/tickets/:ticketId/escalate`

Support only. Allowed for `OPEN`, `NEEDS_INFORMATION`, and `AWAITING_APPROVAL`.

```json
{ "reason": "Issue requires manual review." }
```

Errors: `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 TICKET_NOT_FOUND`,
`409 INVALID_TICKET_STATE`.

## Seed data

### Users

| ID | Email | Password | Role |
| --- | --- | --- | --- |
| USR-CUSTOMER-1 | customer1@s30.test | password123 | CUSTOMER |
| USR-CUSTOMER-2 | customer2@s30.test | password123 | CUSTOMER |
| USR-SUPPORT-1 | support@s30.test | password123 | SUPPORT |

### Products and inventory

| ID | Product | Price | Stock |
| --- | --- | ---: | ---: |
| PROD-KEYBOARD | Mechanical Keyboard | ₹1,500 | 10 |
| PROD-HEADPHONES | Wireless Headphones | ₹4,999 | 5 |
| PROD-MOUSE | Wireless Mouse | ₹999 | 0 |

### Orders

| ID | Owner | Product | Status | Delivered |
| --- | --- | --- | --- | --- |
| ORD-1001 | Customer 1 | Keyboard | DELIVERED | 3 days ago |
| ORD-1002 | Customer 1 | Headphones | DELIVERED | 5 days ago |
| ORD-1003 | Customer 2 | Mouse | DELIVERED | 2 days ago |
| ORD-OLD-1 | Customer 1 | Keyboard | DELIVERED | 45 days ago |
| ORD-SHIPPED-1 | Customer 1 | Keyboard | SHIPPED | null |

## Evaluation priorities

1. Exact routes, status codes, and response envelopes
2. Authentication and customer-data isolation
3. Genuine multi-step tool-calling agent
4. Server-enforced business rules
5. In-memory action and approval workflow
6. Atomicity, idempotency, and concurrency safety
7. Failure handling and secret protection

Tests use a real model. They do not assert exact prose or an exact sequence of read-only tools. They
assert final state, action side effects, ownership, persisted tool traces, and business invariants.
