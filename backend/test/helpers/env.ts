import { resolve } from "node:path";

export const backendDir = resolve(import.meta.dir, "../..");

function parseEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[match[1]!] = value;
  }

  return values;
}

const envFile = Bun.file(resolve(backendDir, ".env"));

export async function loadEvaluatorEnv() {
  if (!(await envFile.exists())) {
    throw new Error("SETUP: backend/.env is required");
  }

  const fileEnv = parseEnv(await envFile.text());
  const merged = { ...fileEnv, ...process.env } as Record<string, string | undefined>;
  const port = merged.PORT;

  if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("SETUP: PORT in backend/.env must be a valid TCP port");
  }
  if (!merged.OPENAI_API_KEY || !merged.OPENAI_MODEL) {
    throw new Error("SETUP: OPENAI_API_KEY and OPENAI_MODEL must be configured in backend/.env");
  }
  if (!merged.JWT_SECRET) {
    throw new Error("SETUP: JWT_SECRET must be configured in backend/.env");
  }
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) childEnv[key] = value;
  }
  childEnv.PORT = port;
  childEnv.NODE_ENV = "test";
  childEnv.EVALUATOR_RESET_TOKEN = crypto.randomUUID();

  return {
    port: Number(port),
    baseUrl: `http://127.0.0.1:${port}`,
    evaluatorToken: childEnv.EVALUATOR_RESET_TOKEN,
    childEnv,
    secrets: [merged.OPENAI_API_KEY, merged.JWT_SECRET].filter((value): value is string => !!value),
  };
}

export type EvaluatorEnv = Awaited<ReturnType<typeof loadEvaluatorEnv>>;
