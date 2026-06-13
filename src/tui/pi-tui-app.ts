import { ProcessTerminal, TUI, type Terminal } from "@earendil-works/pi-tui";
import type { AgentRunner } from "../session/agent-runner.js";
import { RlmSession } from "../session/rlm-session.js";
import { RlmApp } from "./components/rlm-app.js";

export type PiTuiAppOptions = {
  runner: AgentRunner;
  model: string;
  terminal?: Terminal;
  now?: () => Date;
  createTurnId?: () => string;
};

export async function runPiTuiApp(options: PiTuiAppOptions): Promise<void> {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TUI(terminal);
  const session = new RlmSession({
    runner: options.runner,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createTurnId === undefined ? {} : { createTurnId: options.createTurnId }),
  });

  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    finish();
  };

  const app = new RlmApp({ tui, session, model: options.model, onExit: stop, requestRender: () => tui.requestRender() });
  session.subscribe((event) => app.dispatchSessionEvent(event));
  tui.addChild(app);
  tui.setFocus(app);

  try {
    tui.start();
    tui.requestRender(true);
    await done;
  } finally {
    tui.stop();
    terminal.stop();
  }
}
