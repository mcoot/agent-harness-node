import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function filesUnder(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = join(path, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return entry.isFile() && full.endsWith(".ts") ? [full] : [];
  }));
  return nested.flat();
}

describe("dependency boundaries", () => {
  it("keeps agent, trace, RLM, and tools independent of pi-tui", async () => {
    const files = ["src/agent.ts", "src/trace.ts", ...(await filesUnder("src/rlm")), ...(await filesUnder("src/tools"))];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toContain("@earendil-works/pi-tui");
    }
  });
});
