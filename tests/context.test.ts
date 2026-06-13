import { describe, expect, it } from "vitest";
import { createContextPreview, pythonContextSetupSource, truncateWithMarker } from "../src/rlm/context.js";

describe("RLM context preview", () => {
  it("lists keys and truncates top-level values deterministically", () => {
    const long = "x".repeat(700);
    const preview = createContextPreview({ userInput: long, history: [{ role: "user", content: "hello" }] });
    expect(preview).toContain("userInput");
    expect(preview).toContain("history");
    expect(preview).toContain("…[truncated, total 700 chars]");
    expect(preview).not.toContain(long);
  });

  it("uses the standard truncation marker", () => {
    expect(truncateWithMarker("abcdef", 3)).toBe("abc…[truncated, total 6 chars]");
  });

  it("generates Python LimitedString and LimitedHistory wrappers", () => {
    const source = pythonContextSetupSource({ userInput: "hello", history: [{ role: "assistant", content: "world" }] });
    expect(source).toContain("class LimitedString");
    expect(source).toContain("class LimitedHistory");
    expect(source).toContain('"userInput": LimitedString');
  });
});
