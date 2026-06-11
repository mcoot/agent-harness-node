import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ModelMessage } from "ai";
import { runAgentTurn } from "./agent.js";

export async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  const model = process.env.AI_MODEL ?? "claude-haiku-4-5";
  let history: ModelMessage[] = [];

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
        const turn = await runAgentTurn(history, userInput, { model });
        history = turn.messages;
        output.write(`\n${turn.text}\n\n`);
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
