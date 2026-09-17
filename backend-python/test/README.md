# Python evaluator

This folder loads the same Bun black-box evaluator used by the TypeScript backend and points its
server lifecycle at `backend-python`. Both language options are therefore graded against the same HTTP
contract, state transitions, authorization rules, and real-model scenarios.

Run from `backend-python` after creating `.env`:

```bash
uv sync
bun install
bun test
```

The wrapper intentionally skips itself when `bun test` is launched from the repository root, so the
two alternative language submissions are not evaluated together.

The evaluator starts `bun run start` automatically. Do not start Uvicorn separately on the configured
port before running tests.
