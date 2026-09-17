# Evaluator test suite

These are black-box contract tests for the S30 AI Customer Support Agent assignment. They start the
student server with `bun run start`, call only the documented HTTP routes, and use the real provider
configuration from `backend/.env`.

AI provider configuration, `JWT_SECRET`, and `PORT` are loaded from `backend/.env`. The evaluator passes
all provider-specific variables to the student server, so students may use any real provider. Values
whose names end in `API_KEY`, `SECRET`, or `TOKEN` are treated as secrets and are never printed by the
helpers. The evaluator generates a private reset token, starts the server with `NODE_ENV=test`, and
calls the boilerplate-provided `POST /__test/reset` between scenarios.

Required student scripts:

- `bun run start`

Run from `backend`:

```sh
bun test
```

Real-model scenarios have three-minute per-test timeouts and avoid assertions about exact prose or
read-only tool ordering.

Negative-path checks intentionally allow implementation flexibility: an error response must use the
documented HTTP status and return JSON, but the evaluator does not require an exact error code, message,
`details` value, or exact error-envelope key set. Successful response contracts and business side
effects remain strict.

Failures prefixed with `SETUP:` are environment/lifecycle failures. Failures in route assertions are
contract failures. Inventory and action invariants are observed through the guarded, sanitized
`GET /__test/state` endpoint supplied by the boilerplate.
