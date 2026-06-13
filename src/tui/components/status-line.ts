import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { TuiState } from "../state.js";
import { tuiStyle } from "../style.js";

export class StatusLine implements Component {
  constructor(
    private state: TuiState,
    private readonly model: string,
  ) {}

  setState(state: TuiState): void {
    this.state = state;
  }

  render(width: number): string[] {
    const filters = [
      this.state.filters.showToolDetails ? "tools:full" : "tools:brief",
      this.state.filters.showAssistantTrace ? "assistant:on" : "assistant:off",
      this.state.filters.showReasoning ? "reasoning:on" : "reasoning:off",
    ].join(" ");
    const status = this.state.runningTurnId === undefined ? "idle" : "running";
    const message = this.state.statusMessage === undefined ? "Enter submit • \\+Enter newline • Ctrl+T/A/R filters • Ctrl+C exit" : this.state.statusMessage;
    return [truncateToWidth(tuiStyle.muted(`Model: ${this.model} • ${status} • ${filters}`), Math.max(1, width)), truncateToWidth(tuiStyle.muted(message), Math.max(1, width))];
  }

  invalidate(): void {}
}
