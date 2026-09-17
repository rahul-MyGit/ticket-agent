import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadEvaluatorEnv, type EvaluatorEnv } from "./helpers/env";
import {
  createTicket,
  getTicket,
  login,
  runTicket,
  succeededActionCalls,
} from "./helpers/fixtures";
import { api, assertNoSensitiveData, expectError, expectSuccess } from "./helpers/http";
import { StudentServer } from "./helpers/server";
import { expectEvaluatorRoutesAreGuarded, getInventoryStock, resetState } from "./helpers/state";

const AI_TIMEOUT = 180_000;
const SETUP_TIMEOUT = 120_000;

let evaluatorEnv: EvaluatorEnv;
let server: StudentServer;

async function freshFixture() {
  await resetState(evaluatorEnv);
}

function expectOrderedToolTrace(detail: any) {
  expect(Array.isArray(detail.toolCalls)).toBe(true);
  expect(detail.toolCalls.length).toBeGreaterThan(0);
  expect(detail.toolCalls.map((call: any) => call.sequence)).toEqual(
    Array.from({ length: detail.toolCalls.length }, (_, index) => index + 1),
  );

  for (const call of detail.toolCalls) {
    expect(call.id).toMatch(/^TC-/);
    expect(call.toolName).toBeString();
    expect(call.arguments).toBeObject();
    expect(["SUCCEEDED", "FAILED"]).toContain(call.status);
    expect(Number.isNaN(Date.parse(call.createdAt))).toBe(false);
    expect(call).toHaveProperty("result");
    expect(call).toHaveProperty("error");
    if (call.status === "SUCCEEDED") expect(call.error).toBeNull();
    else expect(call.error).not.toBeNull();
  }

  const messageTimes = detail.messages.map((message: any) => Date.parse(message.createdAt));
  expect(messageTimes).toEqual([...messageTimes].sort((a, b) => a - b));
}

function expectNoSuccessfulAction(detail: any) {
  expect(succeededActionCalls(detail)).toHaveLength(0);
}

beforeAll(async () => {
  evaluatorEnv = await loadEvaluatorEnv();
  server = new StudentServer(evaluatorEnv);
  await server.start();
  await resetState(evaluatorEnv);
}, SETUP_TIMEOUT);

afterAll(async () => {
  await server?.stop();
});

describe("S30 customer-support backend evaluator", () => {
  test.serial("health, seeded state, login, authentication, and envelopes", async () => {
    const health = await api<{ status: string }>(evaluatorEnv.baseUrl, "/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ success: true, data: { status: "ok" } });
    await expectEvaluatorRoutesAreGuarded(evaluatorEnv);

    const customer = await login(evaluatorEnv, "customer1");
    expect(customer.user).toEqual({
      id: "USR-CUSTOMER-1",
      name: "Aarav Customer",
      email: "customer1@s30.test",
      role: "CUSTOMER",
    });
    const support = await login(evaluatorEnv, "support");
    expect(support.user.role).toBe("SUPPORT");

    const wrongPassword = await api(evaluatorEnv.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "customer1@s30.test", password: "wrong-password" },
    });
    expectError(wrongPassword, 401, "INVALID_CREDENTIALS");

    const malformed = await api(evaluatorEnv.baseUrl, "/api/auth/login", {
      method: "POST",
      body: { email: "not-an-email" },
    });
    expectError(malformed, 400, "VALIDATION_ERROR");

    const missingToken = await api(evaluatorEnv.baseUrl, "/api/tickets");
    expect(missingToken.status).toBe(401);
    const invalidToken = await api(evaluatorEnv.baseUrl, "/api/tickets", {
      token: "this.is.not-a-valid-jwt",
    });
    expect(invalidToken.status).toBe(401);

    for (const response of [health.body, wrongPassword.body, malformed.body, missingToken.body, invalidToken.body]) {
      assertNoSensitiveData(response, evaluatorEnv.secrets);
    }
  }, 30_000);

  test.serial("ticket creation, validation, sorting, ownership, and support visibility", async () => {
    await freshFixture();
    const customer1 = await login(evaluatorEnv, "customer1");
    const customer2 = await login(evaluatorEnv, "customer2");
    const support = await login(evaluatorEnv, "support");

    const first = await createTicket(evaluatorEnv, customer1.token, {
      orderId: "ORD-1001",
      subject: "Keyboard has broken keys",
      message: "The keyboard arrived with several broken keys.",
    });
    const second = await createTicket(evaluatorEnv, customer1.token, {
      orderId: "ORD-1002",
      subject: "Headphones have a fault",
      message: "The delivered headphones have a persistent fault.",
    });
    const otherCustomerTicket = await createTicket(evaluatorEnv, customer2.token, {
      orderId: "ORD-1003",
      subject: "Mouse arrived damaged",
      message: "The mouse arrived damaged and does not work.",
    });

    const ownListResult = await api<any>(evaluatorEnv.baseUrl, "/api/tickets", {
      token: customer1.token,
    });
    const ownList = expectSuccess(ownListResult, 200).tickets;
    expect(ownList.map((ticket: any) => ticket.id)).toContainAllValues([first.id, second.id]);
    expect(ownList.some((ticket: any) => ticket.id === otherCustomerTicket.id)).toBe(false);
    const timestamps = ownList.map((ticket: any) => Date.parse(ticket.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));

    const filteredResult = await api<any>(evaluatorEnv.baseUrl, "/api/tickets?status=OPEN", {
      token: customer1.token,
    });
    const filtered = expectSuccess(filteredResult, 200).tickets;
    expect(filtered.every((ticket: any) => ticket.status === "OPEN")).toBe(true);

    const supportListResult = await api<any>(evaluatorEnv.baseUrl, "/api/tickets", {
      token: support.token,
    });
    const supportList = expectSuccess(supportListResult, 200).tickets;
    expect(supportList.map((ticket: any) => ticket.id)).toContain(otherCustomerTicket.id);

    expectError(
      await api(evaluatorEnv.baseUrl, "/api/tickets?status=NOT_A_STATUS", { token: customer1.token }),
      400,
      "VALIDATION_ERROR",
    );
    expectError(
      await api(evaluatorEnv.baseUrl, "/api/tickets", {
        method: "POST",
        token: customer1.token,
        body: { subject: "Bad", message: "short" },
      }),
      400,
      "VALIDATION_ERROR",
    );
    expectError(
      await api(evaluatorEnv.baseUrl, "/api/tickets", {
        method: "POST",
        token: customer1.token,
        body: {
          orderId: "ORD-DOES-NOT-EXIST",
          subject: "A valid length subject",
          message: "This references an order that does not exist.",
        },
      }),
      404,
      "ORDER_NOT_FOUND",
    );
    expectError(
      await api(evaluatorEnv.baseUrl, "/api/tickets", {
        method: "POST",
        token: customer1.token,
        body: {
          orderId: "ORD-1003",
          subject: "Trying another customer order",
          message: "This order belongs to a different customer account.",
        },
      }),
      403,
      "ORDER_ACCESS_DENIED",
    );

    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${otherCustomerTicket.id}`, {
        token: customer1.token,
      }),
      403,
      "TICKET_ACCESS_DENIED",
    );
    expectError(
      await runTicket(evaluatorEnv, customer1.token, otherCustomerTicket.id),
      403,
      "TICKET_ACCESS_DENIED",
    );
    expectError(
      await api(evaluatorEnv.baseUrl, "/api/tickets", {
        method: "POST",
        token: support.token,
        body: {
          orderId: "ORD-1001",
          subject: "Support cannot create customer ticket",
          message: "This customer-only endpoint must reject a support account.",
        },
      }),
      403,
      "FORBIDDEN",
    );
    const visibleToSupport = expectSuccess(
      await api<any>(evaluatorEnv.baseUrl, `/api/tickets/${otherCustomerTicket.id}`, {
        token: support.token,
      }),
      200,
    );
    expect(visibleToSupport.ticket.customerId).toBe("USR-CUSTOMER-2");
    expectError(
      await api(evaluatorEnv.baseUrl, "/api/tickets/TKT-NOT-FOUND", { token: support.token }),
      404,
      "TICKET_NOT_FOUND",
    );
  }, SETUP_TIMEOUT);

  test.serial("customer messages and OPEN/NEEDS_INFORMATION transitions", async () => {
    await freshFixture();
    const customer = await login(evaluatorEnv, "customer1");
    const support = await login(evaluatorEnv, "support");
    const ticket = await createTicket(evaluatorEnv, customer.token, {
      subject: "Damaged item but order unknown",
      message:
        "A delivered item is damaged, but I do not know which of my orders it came from. Please ask me for the order number before acting.",
    });

    const run = await runTicket(evaluatorEnv, customer.token, ticket.id);
    const runData = expectSuccess(run, 200);
    expect(runData.status).toBe("NEEDS_INFORMATION");
    expect(runData.finalResponse).toBeString();
    expect(runData.finalResponse.length).toBeGreaterThan(0);

    const messageResult = await api<any>(
      evaluatorEnv.baseUrl,
      `/api/tickets/${ticket.id}/messages`,
      {
        method: "POST",
        token: customer.token,
        body: { content: "The damaged item is from order ORD-1001." },
      },
    );
    const message = expectSuccess(messageResult, 201);
    expect(message.message.role).toBe("CUSTOMER");
    expect(message.message.content).toBe("The damaged item is from order ORD-1001.");
    expect(message.ticketStatus).toBe("OPEN");

    const detail = await getTicket(evaluatorEnv, customer.token, ticket.id);
    expect(detail.messages.at(-1).content).toBe("The damaged item is from order ORD-1001.");
    expect(detail.ticket.status).toBe("OPEN");

    const escalated = expectSuccess(
      await api<any>(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/escalate`, {
        method: "POST",
        token: support.token,
        body: { reason: "Issue requires manual review." },
      }),
      200,
    );
    expect(escalated.status).toBe("ESCALATED");
    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/messages`, {
        method: "POST",
        token: customer.token,
        body: { content: "This message is too late for the terminal ticket." },
      }),
      409,
      "INVALID_TICKET_STATE",
    );
    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/messages`, {
        method: "POST",
        token: support.token,
        body: { content: "Support cannot post through the customer message route." },
      }),
      403,
      "TICKET_ACCESS_DENIED",
    );
  }, AI_TIMEOUT);

  test.serial("damaged keyboard replacement is transactional, persisted, and idempotent", async () => {
    await freshFixture();
    const customer = await login(evaluatorEnv, "customer1");
    const stockBefore = await getInventoryStock(evaluatorEnv, "PROD-KEYBOARD");
    expect(stockBefore).toBe(10);
    const ticket = await createTicket(evaluatorEnv, customer.token, {
      orderId: "ORD-1001",
      subject: "Keyboard arrived damaged",
      message:
        "Order ORD-1001 was delivered three days ago with broken keys. Please inspect the order, policy, and inventory and create a replacement.",
    });

    const run = await runTicket(evaluatorEnv, customer.token, ticket.id);
    const runData = expectSuccess(run, 200);
    expect(runData.status).toBe("RESOLVED");
    expect(runData.finalResponse).toBeString();
    expect(runData.toolCallCount).toBeGreaterThanOrEqual(1);
    expect(runData.toolCallCount).toBeLessThanOrEqual(6);
    expect(runData.pendingAction).toBeNull();

    const detail = await getTicket(evaluatorEnv, customer.token, ticket.id);
    expect(detail.ticket.status).toBe("RESOLVED");
    expectOrderedToolTrace(detail);
    const replacementCalls = detail.toolCalls.filter(
      (call: any) => call.toolName === "createReplacement" && call.status === "SUCCEEDED",
    );
    expect(replacementCalls).toHaveLength(1);
    expect(await getInventoryStock(evaluatorEnv, "PROD-KEYBOARD")).toBe(stockBefore - 1);

    expectError(
      await runTicket(evaluatorEnv, customer.token, ticket.id),
      409,
      "INVALID_TICKET_STATE",
    );
    expect(await getInventoryStock(evaluatorEnv, "PROD-KEYBOARD")).toBe(stockBefore - 1);
    assertNoSensitiveData(detail, evaluatorEnv.secrets);
  }, AI_TIMEOUT);

  test.serial("₹4,999 refund waits for support approval and repeat approval is rejected", async () => {
    await freshFixture();
    const customer = await login(evaluatorEnv, "customer1");
    const support = await login(evaluatorEnv, "support");
    const ticket = await createTicket(evaluatorEnv, customer.token, {
      orderId: "ORD-1002",
      subject: "Refund faulty headphones",
      message:
        "The headphones in delivered order ORD-1002 are faulty. I want a refund, not a replacement. Check the refund policy and create the refund request.",
    });

    const runData = expectSuccess(await runTicket(evaluatorEnv, customer.token, ticket.id), 200);
    expect(runData.status).toBe("AWAITING_APPROVAL");
    expect(runData.pendingAction).toMatchObject({
      type: "REFUND",
      status: "PENDING",
      amount: 4999,
    });

    const beforeApproval = await getTicket(evaluatorEnv, support.token, ticket.id);
    expectOrderedToolTrace(beforeApproval);
    expect(beforeApproval.pendingAction).toMatchObject({ status: "PENDING", amount: 4999 });
    expect(
      beforeApproval.toolCalls.filter(
        (call: any) => call.toolName === "createRefundRequest" && call.status === "SUCCEEDED",
      ),
    ).toHaveLength(1);

    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/approval`, {
        method: "POST",
        token: customer.token,
        body: { decision: "APPROVED", note: "Customer cannot self-approve." },
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/approval`, {
        method: "POST",
        token: support.token,
        body: { decision: "MAYBE", note: "This decision is invalid." },
      }),
      400,
      "VALIDATION_ERROR",
    );

    const approval = expectSuccess(
      await api<any>(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/approval`, {
        method: "POST",
        token: support.token,
        body: { decision: "APPROVED", note: "Checked and approved." },
      }),
      200,
    );
    expect(approval.ticketId).toBe(ticket.id);
    expect(approval.status).toBe("RESOLVED");
    expect(approval.action).toMatchObject({ type: "REFUND", status: "COMPLETED", amount: 4999 });

    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/approval`, {
        method: "POST",
        token: support.token,
        body: { decision: "APPROVED", note: "A repeated approval must not run twice." },
      }),
      409,
      "NO_PENDING_APPROVAL",
    );
  }, AI_TIMEOUT);

  test.serial("support can reject a fresh high-value refund and it escalates", async () => {
    await freshFixture();
    const customer = await login(evaluatorEnv, "customer1");
    const support = await login(evaluatorEnv, "support");
    const ticket = await createTicket(evaluatorEnv, customer.token, {
      orderId: "ORD-1002",
      subject: "Request refund for headphones",
      message:
        "Please refund faulty delivered order ORD-1002. I do not want a replacement. Create a refund request under the refund policy.",
    });
    expect(expectSuccess(await runTicket(evaluatorEnv, customer.token, ticket.id), 200).status).toBe(
      "AWAITING_APPROVAL",
    );

    const rejection = expectSuccess(
      await api<any>(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/approval`, {
        method: "POST",
        token: support.token,
        body: { decision: "REJECTED", note: "Evidence is insufficient; manual review required." },
      }),
      200,
    );
    expect(rejection.status).toBe("ESCALATED");
    expect(rejection.action).toMatchObject({ type: "REFUND", status: "REJECTED", amount: 4999 });
    const detail = await getTicket(evaluatorEnv, support.token, ticket.id);
    expect(detail.ticket.status).toBe("ESCALATED");
    expect(detail.pendingAction).toBeNull();
  }, AI_TIMEOUT);

  test.serial("₹1,500 refund completes automatically and duplicate actions are blocked", async () => {
    await freshFixture();
    const customer = await login(evaluatorEnv, "customer1");
    const refundTicket = await createTicket(evaluatorEnv, customer.token, {
      orderId: "ORD-1001",
      subject: "Refund the damaged keyboard",
      message:
        "The keyboard in delivered order ORD-1001 is damaged. I want a refund, not a replacement. Create the refund request under the policy.",
    });
    const refundRun = expectSuccess(
      await runTicket(evaluatorEnv, customer.token, refundTicket.id),
      200,
    );
    expect(refundRun.status).toBe("RESOLVED");
    expect(refundRun.pendingAction).toBeNull();
    const refundDetail = await getTicket(evaluatorEnv, customer.token, refundTicket.id);
    expect(
      refundDetail.toolCalls.filter(
        (call: any) => call.toolName === "createRefundRequest" && call.status === "SUCCEEDED",
      ),
    ).toHaveLength(1);

    const duplicateTicket = await createTicket(evaluatorEnv, customer.token, {
      orderId: "ORD-1001",
      subject: "Try a second action on keyboard",
      message:
        "Create another refund for ORD-1001. If the duplicate-action policy blocks it, do not alter the existing completed action.",
    });
    const duplicateRun = await runTicket(evaluatorEnv, customer.token, duplicateTicket.id);
    expect(duplicateRun.status).toBe(200);
    const duplicateDetail = await getTicket(evaluatorEnv, customer.token, duplicateTicket.id);
    expectNoSuccessfulAction(duplicateDetail);
    expect(
      refundDetail.toolCalls.filter(
        (call: any) => call.toolName === "createRefundRequest" && call.status === "SUCCEEDED",
      ),
    ).toHaveLength(1);
  }, AI_TIMEOUT);

  test.serial("old, shipped, out-of-stock, and cross-customer orders never mutate protected data", async () => {
    await freshFixture();
    const customer1 = await login(evaluatorEnv, "customer1");
    const customer2 = await login(evaluatorEnv, "customer2");
    const mouseStockBefore = await getInventoryStock(evaluatorEnv, "PROD-MOUSE");

    const cases = [
      {
        token: customer1.token,
        orderId: "ORD-OLD-1",
        subject: "Refund an order delivered too long ago",
        message:
          "Request a refund for ORD-OLD-1, which was delivered 45 days ago. Enforce the refund policy.",
      },
      {
        token: customer1.token,
        orderId: "ORD-SHIPPED-1",
        subject: "Replace a keyboard still being shipped",
        message:
          "Request a replacement for ORD-SHIPPED-1, which is still shipped and not delivered. Enforce the policy.",
      },
      {
        token: customer2.token,
        orderId: "ORD-1003",
        subject: "Replace damaged mouse with no stock",
        message:
          "The mouse in ORD-1003 arrived damaged. Request a replacement and enforce the inventory rule.",
      },
    ];

    for (const scenario of cases) {
      const ticket = await createTicket(evaluatorEnv, scenario.token, scenario);
      const run = await runTicket(evaluatorEnv, scenario.token, ticket.id);
      expect(run.status).toBe(200);
      const detail = await getTicket(evaluatorEnv, scenario.token, ticket.id);
      expectNoSuccessfulAction(detail);
      expect(detail.toolCalls.length).toBeLessThanOrEqual(6);
    }
    expect(await getInventoryStock(evaluatorEnv, "PROD-MOUSE")).toBe(mouseStockBefore);

    const crossCustomerTicket = await createTicket(evaluatorEnv, customer1.token, {
      subject: "Attempt access to an order I do not own",
      message:
        "Try to refund ORD-1003. It belongs to another customer, so backend authorization must prevent access and changes.",
    });
    const crossRun = await runTicket(evaluatorEnv, customer1.token, crossCustomerTicket.id);
    expect(crossRun.status).toBe(200);
    const crossDetail = await getTicket(evaluatorEnv, customer1.token, crossCustomerTicket.id);
    expectNoSuccessfulAction(crossDetail);
    const unauthorizedOrderReads = crossDetail.toolCalls.filter(
      (call: any) => call.toolName === "getOrder" && call.arguments?.orderId === "ORD-1003",
    );
    expect(unauthorizedOrderReads.every((call: any) => call.status === "FAILED")).toBe(true);
    expect(await getInventoryStock(evaluatorEnv, "PROD-MOUSE")).toBe(mouseStockBefore);
  }, AI_TIMEOUT * 2);

  test.serial("simultaneous runs permit one execution and create no duplicate action", async () => {
    await freshFixture();
    const customer = await login(evaluatorEnv, "customer1");
    const ticket = await createTicket(evaluatorEnv, customer.token, {
      orderId: "ORD-1001",
      subject: "Concurrent replacement request",
      message:
        "The keyboard in ORD-1001 arrived damaged. Check the order, policy, and stock, then create exactly one replacement.",
    });
    const stockBefore = await getInventoryStock(evaluatorEnv, "PROD-KEYBOARD");

    const [first, second] = await Promise.all([
      runTicket(evaluatorEnv, customer.token, ticket.id),
      runTicket(evaluatorEnv, customer.token, ticket.id),
    ]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);
    const conflict = first.status === 409 ? first : second;
    expectError(conflict, 409, "TICKET_ALREADY_PROCESSING");

    const detail = await getTicket(evaluatorEnv, customer.token, ticket.id);
    expect(detail.ticket.status).toBe("RESOLVED");
    expect(succeededActionCalls(detail)).toHaveLength(1);
    expect(await getInventoryStock(evaluatorEnv, "PROD-KEYBOARD")).toBe(stockBefore - 1);
  }, AI_TIMEOUT);

  test.serial("manual escalation permissions, validation, and allowed states", async () => {
    await freshFixture();
    const customer = await login(evaluatorEnv, "customer1");
    const support = await login(evaluatorEnv, "support");
    const ticket = await createTicket(evaluatorEnv, customer.token, {
      orderId: "ORD-1001",
      subject: "Manual review is required",
      message: "Please have support manually review this damaged keyboard issue.",
    });

    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/escalate`, {
        method: "POST",
        token: customer.token,
        body: { reason: "Customer cannot manually escalate through this route." },
      }),
      403,
      "FORBIDDEN",
    );
    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/escalate`, {
        method: "POST",
        token: support.token,
        body: { reason: "x" },
      }),
      400,
      "VALIDATION_ERROR",
    );
    const escalated = expectSuccess(
      await api<any>(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/escalate`, {
        method: "POST",
        token: support.token,
        body: { reason: "Issue requires manual review." },
      }),
      200,
    );
    expect(escalated).toEqual({
      ticketId: ticket.id,
      status: "ESCALATED",
      escalationReason: "Issue requires manual review.",
    });
    expectError(
      await api(evaluatorEnv.baseUrl, `/api/tickets/${ticket.id}/escalate`, {
        method: "POST",
        token: support.token,
        body: { reason: "Cannot escalate a terminal ticket twice." },
      }),
      409,
      "INVALID_TICKET_STATE",
    );
  }, SETUP_TIMEOUT);

  test.serial("representative responses do not expose secrets or hidden reasoning", async () => {
    const customer = await login(evaluatorEnv, "customer1");
    const support = await login(evaluatorEnv, "support");
    const responses = [
      (await api(evaluatorEnv.baseUrl, "/health")).body,
      (await api(evaluatorEnv.baseUrl, "/api/tickets", { token: customer.token })).body,
      (await api(evaluatorEnv.baseUrl, "/api/tickets", { token: support.token })).body,
      (
        await api(evaluatorEnv.baseUrl, "/api/tickets/TKT-NOT-FOUND", {
          token: support.token,
        })
      ).body,
    ];
    for (const response of responses) assertNoSensitiveData(response, evaluatorEnv.secrets);
  });
});
