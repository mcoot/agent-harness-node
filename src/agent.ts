import { anthropic } from "@ai-sdk/anthropic";
import { streamText, stepCountIs } from "ai";
import { createContextPreview, type RlmContext } from "./rlm/context.js";
import { createRlmReplSession, type RlmReplSession } from "./rlm/repl.js";
import { normalizeTextStreamPart, type AgentTraceEvent } from "./trace.js";
import { createReplTool } from "./tools/repl.js";

export type AgentConversationEntry =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type AgentOptions = {
  model: string;
  maxSteps?: number;
  maxFinalizationAttempts?: number;
  rootDirectory?: string;
  onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
  createReplSession?: (context: RlmContext) => Promise<RlmReplSession>;
};

export type AgentTurn = {
  text: string;
  messages: AgentConversationEntry[];
};

const systemPrompt = `You are an RLM-style local agent harness.

You do not receive the user's full input directly in the chat prompt. A Python REPL tool has already been initialized with context containing the full user input and prior conversation history. Inspect context with the repl tool, do any reasoning or computation in Python, and provide the user-visible answer only by calling FINAL(...) or FINAL_VAR(...) from Python.

Ordinary assistant text is trace-only and will not be shown as the final answer. Do not answer in ordinary assistant text.`;

const finalizationReminder =
  "You did not call FINAL(...) or FINAL_VAR(...). Continue using the repl tool already initialized with context. You must call FINAL(...) or FINAL_VAR(...) to provide the user-visible answer. Do not answer in ordinary assistant text.";

async function emitTrace(
  callback: AgentOptions["onTrace"],
  event: AgentTraceEvent,
): Promise<void> {
  if (callback !== undefined) await callback(event);
}

async function consumeStream(
  fullStream: AsyncIterable<unknown>,
  onTrace: AgentOptions["onTrace"],
): Promise<void> {
  for await (const part of fullStream) {
    for (const event of normalizeTextStreamPart(part)) {
      await emitTrace(onTrace, event);
    }
  }
}

export async function runAgentTurn(
  history: readonly AgentConversationEntry[],
  userInput: string,
  options: AgentOptions,
): Promise<AgentTurn> {
  const maxSteps = options.maxSteps ?? 5;
  const maxFinalizationAttempts = options.maxFinalizationAttempts ?? 2;
  if (!Number.isInteger(maxFinalizationAttempts) || maxFinalizationAttempts < 1) {
    throw new Error("maxFinalizationAttempts must be an integer greater than or equal to 1");
  }

  const context: RlmContext = { userInput, history };
  const sessionFactory = options.createReplSession ?? createRlmReplSession;
  const session = await sessionFactory(context);

  try {
    const preview = createContextPreview(context);
    const tools = { repl: createReplTool(session) };

    for (let attempt = 1; attempt <= maxFinalizationAttempts; attempt += 1) {
      const result = streamText({
        model: anthropic(options.model),
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: attempt === 1 ? preview : finalizationReminder,
          },
        ],
        tools,
        stopWhen: stepCountIs(maxSteps),
      });

      await consumeStream(result.fullStream, options.onTrace);
      await result.response;

      const finalOutput = await session.getFinalOutput();
      if (finalOutput !== undefined) {
        const messages: AgentConversationEntry[] = [
          ...history,
          { role: "user", content: userInput },
          { role: "assistant", content: finalOutput.text },
        ];
        return { text: finalOutput.text, messages };
      }
    }

    throw new Error(
      `Model did not call FINAL(...) or FINAL_VAR(...) after ${maxFinalizationAttempts} attempt(s)`,
    );
  } finally {
    await session.dispose();
  }
}
