import { expect } from "bun:test";
import type { EvaluatorEnv } from "./env";
import { api } from "./http";

export async function resetState(evaluatorEnv: EvaluatorEnv) {
  const result = await fetch(`${evaluatorEnv.baseUrl}/__test/reset`, {
    method: "POST",
    headers: { "x-evaluator-token": evaluatorEnv.evaluatorToken },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ success: true, data: { status: "reset" } });
}

export async function getEvaluatorState(evaluatorEnv: EvaluatorEnv) {
  const result = await fetch(`${evaluatorEnv.baseUrl}/__test/state`, {
    headers: { "x-evaluator-token": evaluatorEnv.evaluatorToken },
  });
  expect(result.status).toBe(200);
  const body = (await result.json()) as {
    success: true;
    data: {
      inventory: Array<{ productId: string; stock: number }>;
      actions: Array<Record<string, unknown>>;
      approvals: Array<Record<string, unknown>>;
    };
  };
  expect(body.success).toBe(true);
  return body.data;
}

export async function getInventoryStock(evaluatorEnv: EvaluatorEnv, productId: string) {
  const state = await getEvaluatorState(evaluatorEnv);
  const item = state.inventory.find((entry) => entry.productId === productId);
  expect(item).toBeDefined();
  return item!.stock;
}

export async function expectEvaluatorRoutesAreGuarded(evaluatorEnv: EvaluatorEnv) {
  const result = await api(evaluatorEnv.baseUrl, "/__test/state");
  expect(result.status).toBe(404);
}
