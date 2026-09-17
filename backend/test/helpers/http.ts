import { expect } from "bun:test";

export type SuccessEnvelope<T> = { success: true; data: T };
export type ErrorEnvelope = {
  success: false;
  error: { code: string; message: string; details?: unknown };
};

export type ApiResult<T = unknown> = {
  status: number;
  body: SuccessEnvelope<T> | ErrorEnvelope;
  headers: Headers;
};

export async function api<T = unknown>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<ApiResult<T>> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  expect(response.headers.get("content-type")?.toLowerCase()).toContain("application/json");
  const body = (await response.json()) as SuccessEnvelope<T> | ErrorEnvelope;
  assertEnvelope(body, response.ok);
  return { status: response.status, body, headers: response.headers };
}

export function assertEnvelope(
  body: unknown,
  successfulResponse = true,
): asserts body is SuccessEnvelope<unknown> | ErrorEnvelope {
  expect(body).toBeObject();
  if (!successfulResponse) return;

  const record = body as Record<string, unknown>;
  expect(record.success).toBe(true);
  expect(Object.keys(record).sort()).toEqual(["data", "success"]);
  expect(record).toHaveProperty("data");
}

export function expectSuccess<T>(result: ApiResult<T>, status: number): T {
  expect(result.status).toBe(status);
  expect(result.body.success).toBe(true);
  return (result.body as SuccessEnvelope<T>).data;
}

export function expectError(result: ApiResult, status: number, _code?: string) {
  expect(result.status).toBe(status);
  expect(result.body).toBeObject();
}

export function assertNoSensitiveData(value: unknown, secrets: string[]) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) expect(serialized).not.toContain(secret);
  expect(serialized).not.toMatch(/passwordHash|password_hash|jwtSecret|OPENAI_API_KEY|systemPrompt|chain.?of.?thought/i);
  expect(serialized).not.toMatch(/\bat\s+[\w$.<>]+\s*\([^\n]+:\d+:\d+\)/);
}
