import { expect } from "bun:test";
import type { EvaluatorEnv } from "./env";
import { api, expectSuccess } from "./http";

export const users = {
  customer1: { email: "customer1@s30.test", password: "password123", id: "USR-CUSTOMER-1" },
  customer2: { email: "customer2@s30.test", password: "password123", id: "USR-CUSTOMER-2" },
  support: { email: "support@s30.test", password: "password123", id: "USR-SUPPORT-1" },
} as const;

export async function login(evaluatorEnv: EvaluatorEnv, user: keyof typeof users) {
  const expected = users[user];
  const result = await api<{
    token: string;
    user: { id: string; name: string; email: string; role: "CUSTOMER" | "SUPPORT" };
  }>(evaluatorEnv.baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email: expected.email, password: expected.password },
  });
  const data = expectSuccess(result, 200);
  expect(data.token).toBeString();
  expect(data.token.length).toBeGreaterThan(20);
  expect(data.user.id).toBe(expected.id);
  expect(data.user.email).toBe(expected.email);
  return data;
}

export async function createTicket(
  evaluatorEnv: EvaluatorEnv,
  token: string,
  input: { orderId?: string; subject: string; message: string },
) {
  const result = await api<{
    id: string;
    customerId: string;
    orderId: string | null;
    subject: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>(evaluatorEnv.baseUrl, "/api/tickets", { method: "POST", token, body: input });
  const ticket = expectSuccess(result, 201);
  expect(ticket.id).toMatch(/^TKT-/);
  expect(ticket.status).toBe("OPEN");
  expect(Number.isNaN(Date.parse(ticket.createdAt))).toBe(false);
  return ticket;
}

export async function getTicket(evaluatorEnv: EvaluatorEnv, token: string, ticketId: string) {
  const result = await api<any>(evaluatorEnv.baseUrl, `/api/tickets/${ticketId}`, { token });
  return expectSuccess(result, 200);
}

export async function runTicket(evaluatorEnv: EvaluatorEnv, token: string, ticketId: string) {
  return api<any>(evaluatorEnv.baseUrl, `/api/tickets/${ticketId}/run`, {
    method: "POST",
    token,
  });
}

export function succeededActionCalls(detail: any) {
  return detail.toolCalls.filter(
    (call: any) =>
      call.status === "SUCCEEDED" &&
      ["createReplacement", "createRefundRequest"].includes(call.toolName),
  );
}
