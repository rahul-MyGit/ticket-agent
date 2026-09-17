import express, { type NextFunction, type Request, type Response } from "express";
import { resetState, state } from "./state";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_request: Request, response: Response) => {
  response.status(200).json({ success: true, data: { status: "ok" } });
});

function allowEvaluator(request: Request, response: Response, next: NextFunction) {
  const expectedToken = process.env.EVALUATOR_RESET_TOKEN;
  const suppliedToken = request.header("x-evaluator-token");

  if (process.env.NODE_ENV !== "test" || !expectedToken || suppliedToken !== expectedToken) {
    response.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
    return;
  }

  next();
}

app.post("/__test/reset", allowEvaluator, (_request: Request, response: Response) => {
  if (!resetState()) {
    response.status(409).json({
      success: false,
      error: {
        code: "RESET_BLOCKED",
        message: "State cannot be reset while an agent run is active",
      },
    });
    return;
  }

  response.status(200).json({ success: true, data: { status: "reset" } });
});

// Sanitized evaluator visibility for invariants public routes cannot expose.
app.get("/__test/state", allowEvaluator, (_request: Request, response: Response) => {
  response.status(200).json({
    success: true,
    data: {
      inventory: state.inventory,
      actions: state.actions.map(({ id, ticketId, orderId, type, status, amount }) => ({
        id,
        ticketId,
        orderId,
        type,
        status,
        amount,
      })),
      approvals: state.approvals.map(({ id, ticketId, actionId, decision }) => ({
        id,
        ticketId,
        actionId,
        decision,
      })),
    },
  });
});

// Students add the documented authentication and ticket routes above this fallback.
app.use((_request: Request, response: Response) => {
  response.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
});

const port = Number(process.env.PORT ?? 3000);
export const server = app.listen(port, "127.0.0.1", () => {
  console.log(`S30 support backend listening on http://127.0.0.1:${port}`);
});

// Keep the Bun process alive while Express owns the HTTP listener.
await new Promise<void>(() => {});
