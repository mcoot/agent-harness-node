import { stdin as input, stdout as output, stderr } from "node:process";
import type { Readable, Writable } from "node:stream";
import { parseCliArgs, shouldUseTui } from "./cli/args.js";
import { runNoTui } from "./cli/no-tui.js";
import { createDefaultAgentRunner, type AgentRunner } from "./session/agent-runner.js";
import { runPiTuiApp } from "./tui/pi-tui-app.js";

export type CliStreams = {
  input: Readable & { isTTY?: boolean };
  output: Writable & { isTTY?: boolean };
};

export type RunCliOptions = {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  streams: CliStreams;
  cwd?: string;
  createRunner?: (model: string) => AgentRunner;
  runTui?: (options: { runner: AgentRunner; model: string }) => Promise<void>;
  runPlain?: (options: { runner: AgentRunner; model: string; input: CliStreams["input"]; output: CliStreams["output"] }) => Promise<void>;
};

export async function runCli(options: RunCliOptions): Promise<void> {
  const parsed = parseCliArgs(options.argv, options.env);
  const streams = {
    ...(options.streams.input.isTTY === undefined ? {} : { stdinIsTTY: options.streams.input.isTTY }),
    ...(options.streams.output.isTTY === undefined ? {} : { stdoutIsTTY: options.streams.output.isTTY }),
  };

  if (parsed.mode === "tui" && (streams.stdinIsTTY !== true || streams.stdoutIsTTY !== true)) {
    throw new Error("--tui requires both stdin and stdout to be TTY streams. Use --no-tui for pipes.");
  }

  const runner = options.createRunner?.(parsed.model) ?? createDefaultAgentRunner({ model: parsed.model, rootDirectory: options.cwd ?? process.cwd() });
  if (shouldUseTui(parsed.mode, streams)) {
    await (options.runTui ?? ((runOptions) => runPiTuiApp(runOptions)))({ runner, model: parsed.model });
  } else {
    await (options.runPlain ?? ((runOptions) => runNoTui(runOptions)))({ runner, model: parsed.model, input: options.streams.input, output: options.streams.output });
  }
}

export async function main(): Promise<void> {
  await runCli({ argv: process.argv.slice(2), env: process.env, streams: { input, output }, cwd: process.cwd() });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
