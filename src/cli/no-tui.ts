import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { formatFinalAnswer, renderTraceEvent } from "../trace-renderer.js";
import { RlmSession, type HarnessSessionEvent } from "../session/rlm-session.js";
import type { AgentRunner } from "../session/agent-runner.js";

export type NoTuiOptions = {
  runner: AgentRunner;
  model: string;
  input: Readable & { isTTY?: boolean };
  output: Pick<Writable, "write"> & { isTTY?: boolean };
  now?: () => Date;
  createTurnId?: () => string;
};

function renderSessionEvent(output: Pick<Writable, "write">, event: HarnessSessionEvent): void {
  switch (event.type) {
    case "trace":
      renderTraceEvent(output, event.event);
      break;
    case "turn-final":
      output.write(formatFinalAnswer(event.text));
      break;
    case "turn-error":
      output.write(`\nAgent error: ${event.message}\n\n`);
      break;
    default:
      break;
  }
}

async function readAll(stream: Readable): Promise<string> {
  let text = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) text += String(chunk);
  return text;
}

function stripOneTrailingLineEnding(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n") || text.endsWith("\r")) return text.slice(0, -1);
  return text;
}

export async function runNoTui(options: NoTuiOptions): Promise<void> {
  const session = new RlmSession({
    runner: options.runner,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createTurnId === undefined ? {} : { createTurnId: options.createTurnId }),
  });
  session.subscribe((event) => renderSessionEvent(options.output, event));

  if (options.input.isTTY !== true) {
    const prompt = stripOneTrailingLineEnding(await readAll(options.input));
    if (prompt.trim().length === 0) return;
    await session.submit(prompt);
    return;
  }

  const rl = createInterface({ input: options.input, output: options.output as Writable, terminal: true });
  options.output.write(`Minimal agent harness\nModel: ${options.model}\nType /exit to quit.\n\n`);

  try {
    options.output.write("> ");
    for await (const userInput of rl) {
      const result = await session.submit(userInput);
      if (result.status === "exit") break;
      if (result.status === "rejected") options.output.write("Agent is busy; wait for the current turn to finish.\n");
      options.output.write("> ");
    }
  } finally {
    rl.close();
  }
}
