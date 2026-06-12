import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createReadFileTool } from "./tools/read-file.js";

export type AgentOptions = {
  model: string;
  maxSteps?: number;
  rootDirectory?: string;
};

export type AgentTurn = {
  text: string;
  messages: ModelMessage[];
};

const systemPrompt = `You are a minimal local agent harness.

You can have multi-turn conversations with the user. Use the readFile tool when you need to inspect a project file. Keep answers concise.`;

export async function runAgentTurn(
  history: readonly ModelMessage[],
  userInput: string,
  options: AgentOptions,
): Promise<AgentTurn> {
  const maxSteps = options.maxSteps ?? 5;
  const messages: ModelMessage[] = [
    ...history,
    { role: "user", content: userInput },
  ];

  const result = await generateText({
    model: anthropic(options.model),
    system: systemPrompt,
    messages,
    tools: {
      readFile: createReadFileTool(
        options.rootDirectory === undefined
          ? {}
          : { rootDirectory: options.rootDirectory },
      ),
    },
    stopWhen: stepCountIs(maxSteps),
  });

  return {
    text: result.text,
    messages: [...messages, ...result.response.messages],
  };
}
