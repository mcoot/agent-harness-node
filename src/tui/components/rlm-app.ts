import { Key, matchesKey, truncateToWidth, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { RlmSession, HarnessSessionEvent } from "../../session/rlm-session.js";
import { createInitialTuiState, tuiReducer, type TuiState } from "../state.js";
import { Composer } from "./composer.js";
import { StatusLine } from "./status-line.js";
import { Transcript } from "./transcript.js";

export type RlmAppOptions = {
  tui: TUI;
  session: RlmSession;
  model: string;
  onExit: () => void;
  requestRender?: () => void;
};

export class RlmApp implements Component, Focusable {
  private state: TuiState = createInitialTuiState();
  readonly composer: Composer;
  private readonly transcript: Transcript;
  private readonly statusLine: StatusLine;
  private exitAfterTurn = false;

  get focused(): boolean {
    return this.composer.focused;
  }

  set focused(value: boolean) {
    this.composer.focused = value;
  }

  constructor(private readonly options: RlmAppOptions) {
    this.composer = new Composer(options.tui);
    this.transcript = new Transcript(this.state);
    this.statusLine = new StatusLine(this.state, options.model);
    this.composer.onSubmit = (text) => void this.submit(text);
  }

  getState(): TuiState {
    return this.state;
  }

  dispatchSessionEvent(event: HarnessSessionEvent): void {
    this.dispatch({ type: "session-event", event });
    if (this.exitAfterTurn && event.type === "turn-finished") this.options.onExit();
  }

  private dispatch(action: Parameters<typeof tuiReducer>[1]): void {
    this.state = tuiReducer(this.state, action);
    this.transcript.setState(this.state);
    this.statusLine.setState(this.state);
    this.invalidate();
    this.options.requestRender?.();
  }

  private async submit(text: string): Promise<void> {
    const result = await this.options.session.submit(text);
    switch (result.status) {
      case "exit":
        this.options.onExit();
        break;
      case "ignored":
        break;
      case "rejected":
        this.dispatch({ type: "set-status", message: "Turn running; wait for it to finish" });
        break;
      case "accepted":
        break;
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl("t"))) {
      this.dispatch({ type: "toggle-tool-details" });
      return;
    }
    if (matchesKey(data, Key.ctrl("a"))) {
      this.dispatch({ type: "toggle-assistant-trace" });
      return;
    }
    if (matchesKey(data, Key.ctrl("r"))) {
      this.dispatch({ type: "toggle-reasoning" });
      return;
    }
    if (matchesKey(data, Key.ctrl("c"))) {
      if (this.state.runningTurnId === undefined) this.options.onExit();
      else {
        this.exitAfterTurn = true;
        this.dispatch({ type: "set-status", message: "Turn running; exit after turn finishes" });
      }
      return;
    }
    this.composer.handleInput(data);
    this.options.requestRender?.();
  }

  render(width: number): string[] {
    const w = Math.max(1, width);
    const separator = truncateToWidth("─".repeat(Math.max(1, w)), w, "");
    return [
      truncateToWidth("RLM Harness", w),
      ...this.transcript.render(w),
      separator,
      ...this.statusLine.render(w),
      truncateToWidth("Prompt:", w),
      ...this.composer.render(w),
    ].map((line) => truncateToWidth(line, w));
  }

  invalidate(): void {
    this.transcript.invalidate();
    this.statusLine.invalidate();
    this.composer.invalidate();
  }
}
