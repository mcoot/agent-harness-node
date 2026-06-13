import { describe, expect, it } from "vitest";
import { createRlmReplSession } from "../src/rlm/repl.js";

describe("Pyodide RLM REPL session", () => {
  it("executes Python with REPL-style result previews, stdout, errors, and final capture", async () => {
    const session = await createRlmReplSession({ userInput: "hello", history: [] });
    try {
      await expect(session.execute("x = 1\nx + 1")).resolves.toMatchObject({ resultPreview: "2", finalSet: false });
      await expect(session.execute('print("hi")')).resolves.toMatchObject({ stdout: "hi\n" });
      const error = await session.execute('raise ValueError("bad")');
      expect(error.stderr).toContain("ValueError: bad");

      await session.execute('FINAL("done")');
      await expect(session.getFinalOutput()).resolves.toMatchObject({ kind: "string", text: "done" });
    } finally {
      await session.dispose();
    }
  }, 60_000);

  it("formats FINAL_VAR JSON deterministically", async () => {
    const session = await createRlmReplSession({ userInput: "hello", history: [] });
    try {
      await session.execute('FINAL_VAR({"b": 2, "a": 1})');
      await expect(session.getFinalOutput()).resolves.toMatchObject({
        kind: "json",
        text: '{\n  "a": 1,\n  "b": 2\n}',
      });
    } finally {
      await session.dispose();
    }
  }, 60_000);

  it("rejects execution after dispose", async () => {
    const session = await createRlmReplSession({ userInput: "hello", history: [] });
    await session.dispose();
    await expect(session.execute("1 + 1")).rejects.toThrow("disposed");
  }, 60_000);
});
