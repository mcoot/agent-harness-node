#!/usr/bin/env node
import { runPiTuiApp } from "../../dist/tui/pi-tui-app.js";

const runner = {
  async runTurn(history, input, callbacks) {
    await callbacks.onTrace({ type: "tool-call", toolName: "repl", input: { code: `prompt = ${JSON.stringify(input)}\n# FULL_PYTHON_DETAIL\nprint(prompt)` }, toolCallId: "fake-1" });
    await callbacks.onTrace({ type: "tool-result", toolName: "repl", output: { stdout: `stdout for ${input}\n`, stderr: "", resultPreview: `result for ${input}`, finalSet: true }, toolCallId: "fake-1" });
    await callbacks.onTrace({ type: "assistant-text-delta", text: `assistant trace for ${input}` });
    await callbacks.onTrace({ type: "assistant-reasoning-delta", text: `reasoning trace for ${input}` });
    return {
      text: `fake answer: ${input}`,
      messages: [...history, { role: "user", content: input }, { role: "assistant", content: `fake answer: ${input}` }],
    };
  },
};

await runPiTuiApp({ runner, model: "fake-model" });
