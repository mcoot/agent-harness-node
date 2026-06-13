import { runAgentTurn, type AgentConversationEntry, type AgentOptions, type AgentTurn } from "../agent.js";
import type { AgentTraceEvent } from "../trace.js";

export interface AgentRunner {
  runTurn(
    history: readonly AgentConversationEntry[],
    input: string,
    callbacks: { onTrace(event: AgentTraceEvent): void | Promise<void> },
  ): Promise<AgentTurn>;
}

export type DefaultAgentRunnerOptions = Omit<AgentOptions, "onTrace">;

export function createDefaultAgentRunner(options: DefaultAgentRunnerOptions): AgentRunner {
  return {
    runTurn: (history, input, callbacks) =>
      runAgentTurn(history, input, {
        ...options,
        onTrace: callbacks.onTrace,
      }),
  };
}
