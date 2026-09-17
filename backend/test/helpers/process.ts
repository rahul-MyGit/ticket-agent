import { backendDir, type EvaluatorEnv } from "./env";

export async function runProjectCommand(
  args: string[],
  evaluatorEnv: EvaluatorEnv,
  label: string,
) {
  const process = Bun.spawn(args, {
    cwd: backendDir,
    env: evaluatorEnv.childEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `SETUP: ${label} failed with exit code ${exitCode}\n${sanitizeOutput(`${stdout}\n${stderr}`, evaluatorEnv)}`,
    );
  }

  return { stdout: sanitizeOutput(stdout, evaluatorEnv), stderr: sanitizeOutput(stderr, evaluatorEnv) };
}

export function sanitizeOutput(output: string, evaluatorEnv: EvaluatorEnv) {
  let sanitized = output;
  for (const secret of [...evaluatorEnv.secrets, evaluatorEnv.evaluatorToken]) {
    sanitized = sanitized.split(secret).join("[REDACTED]");
  }
  return sanitized;
}
