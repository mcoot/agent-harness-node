import type { AgentConversationEntry } from "../agent.js";
import type { AgentTraceEvent } from "../trace.js";
import type { AgentRunner } from "./agent-runner.js";

export type HarnessSessionEvent =
  | { type: "turn-started"; turnId: string; input: string; at: Date }
  | { type: "trace"; turnId: string; event: AgentTraceEvent; at: Date }
  | { type: "turn-final"; turnId: string; text: string; at: Date }
  | { type: "turn-error"; turnId: string; message: string; at: Date }
  | { type: "turn-finished"; turnId: string; at: Date };

export type SubmitResult =
  | { status: "accepted"; turnId: string }
  | { status: "ignored"; reason: "empty" }
  | { status: "rejected"; reason: "busy" }
  | { status: "exit"; command: "/exit" | "/quit" };

export type RlmSessionOptions = {
  runner: AgentRunner;
  now?: () => Date;
  createTurnId?: () => string;
};

type Listener = (event: HarnessSessionEvent) => void;

export class RlmSession {
  private readonly runner: AgentRunner;
  private readonly now: () => Date;
  private readonly createTurnId: () => string;
  private readonly listeners = new Set<Listener>();
  private history: AgentConversationEntry[] = [];
  private busy = false;
  private nextTurnNumber = 1;

  constructor(options: RlmSessionOptions) {
    this.runner = options.runner;
    this.now = options.now ?? (() => new Date());
    this.createTurnId = options.createTurnId ?? (() => `turn-${this.nextTurnNumber++}`);
  }

  getHistory(): readonly AgentConversationEntry[] {
    return this.history;
  }

  isBusy(): boolean {
    return this.busy;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: Listener): () => void {
    return this.subscribe(listener);
  }

  private emit(event: HarnessSessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async submit(input: string): Promise<SubmitResult> {
    const normalizedInput = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const command = normalizedInput.trim().toLowerCase();

    if (command.length === 0) return { status: "ignored", reason: "empty" };
    if (command === "/exit" || command === "/quit") return { status: "exit", command };
    if (this.busy) return { status: "rejected", reason: "busy" };

    const turnId = this.createTurnId();
    this.busy = true;
    this.emit({ type: "turn-started", turnId, input: normalizedInput, at: this.now() });

    try {
      const turn = await this.runner.runTurn(this.history, normalizedInput, {
        onTrace: async (event) => {
          this.emit({ type: "trace", turnId, event, at: this.now() });
        },
      });
      this.history = [...turn.messages];
      this.emit({ type: "turn-final", turnId, text: turn.text, at: this.now() });
      return { status: "accepted", turnId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: "turn-error", turnId, message, at: this.now() });
      return { status: "accepted", turnId };
    } finally {
      this.busy = false;
      this.emit({ type: "turn-finished", turnId, at: this.now() });
    }
  }
}
