import type { Subprocess } from "bun";
import type { EvaluatorEnv } from "./env";
import { backendDir } from "./env";
import { sanitizeOutput } from "./process";

export class StudentServer {
  #process: Subprocess<"ignore", "pipe", "pipe"> | null = null;
  #env: EvaluatorEnv;

  constructor(evaluatorEnv: EvaluatorEnv) {
    this.#env = evaluatorEnv;
  }

  async start() {
    if (this.#process) return;
    const packageJson = await Bun.file(`${backendDir}/package.json`).json();
    if (!packageJson.scripts?.start) {
      throw new Error("SETUP: package.json must define the required start script");
    }

    this.#process = Bun.spawn(["bun", "run", "start"], {
      cwd: backendDir,
      env: this.#env.childEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.#process.exitCode !== null) {
        const stdout = await new Response(this.#process.stdout).text();
        const stderr = await new Response(this.#process.stderr).text();
        this.#process = null;
        throw new Error(
          `SETUP: server exited before becoming healthy\n${sanitizeOutput(`${stdout}\n${stderr}`, this.#env)}`,
        );
      }

      try {
        const response = await fetch(`${this.#env.baseUrl}/health`);
        if (response.ok) return;
      } catch {
        // The server is still starting; poll until the deadline.
      }
      await Bun.sleep(100);
    }

    await this.stop();
    throw new Error("SETUP: server did not become healthy within 30 seconds");
  }

  async stop() {
    const process = this.#process;
    this.#process = null;
    if (!process || process.exitCode !== null) return;
    process.kill("SIGTERM");
    const exited = process.exited;
    const timeout = Bun.sleep(3_000).then(() => "timeout" as const);
    if ((await Promise.race([exited, timeout])) === "timeout" && process.exitCode === null) {
      process.kill("SIGKILL");
      await process.exited;
    }
  }
}
