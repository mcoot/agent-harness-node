import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgentTurn, type AgentConversationEntry } from "./agent.js";
import { formatFinalAnswer, renderTraceEvent } from "./trace-renderer.js";

export async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  const model = process.env.AI_MODEL ?? "claude-haiku-4-5";
  let history: AgentConversationEntry[] = [];

  output.write(`Minimal agent harness\nModel: ${model}\nType /exit to quit.\n\n`);

  try {
    while (true) {
      const userInput = (await rl.question("> ")).trim();

      if (userInput.length === 0) {
        continue;
      }

      if (["/exit", "/quit"].includes(userInput.toLowerCase())) {
        break;
      }

      try {
        const turn = await runAgentTurn(history, userInput, {
          model,
          onTrace: async (event) => renderTraceEvent(output, event),
        });
        history = turn.messages;
        output.write(formatFinalAnswer(turn.text));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.write(`\nAgent error: ${message}\n\n`);
      }
    }
  } finally {
    rl.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
