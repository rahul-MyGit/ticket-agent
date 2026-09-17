import { resolve } from "node:path";

const pythonBackendDir = resolve(import.meta.dir, "..");

if (resolve(process.cwd()) === pythonBackendDir) {
  // Reuse the language-neutral black-box evaluator while starting this Python backend.
  process.env.EVALUATOR_BACKEND_DIR = pythonBackendDir;
  await import("../../backend/test/evaluator.test");
} else {
  const { test } = await import("bun:test");
  test.skip("run the Python evaluator from backend-python", () => {});
}
