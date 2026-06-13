import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import packageLock from "../package-lock.json" with { type: "json" };

describe("package metadata", () => {
  it("declares required scripts, dependencies, and Node engine", () => {
    expect(packageJson.engines.node).toBe(">=22.19.0");
    expect(packageJson.dependencies).toHaveProperty("@earendil-works/pi-tui");
    expect(packageJson.devDependencies).toHaveProperty("node-pty");
    expect(packageJson.scripts.clean).toBe("rm -rf dist");
    expect(packageJson.scripts.build).toContain("npm run clean && tsc");
    expect(packageJson.scripts.test).toContain("--exclude tests/pty/**");
    expect(packageJson.scripts["test:pty"]).toContain("tests/pty/*.test.ts");

    const root = packageLock.packages[""];
    expect(root.engines.node).toBe(">=22.19.0");
    expect(root.dependencies).toHaveProperty("@earendil-works/pi-tui");
    expect(root.devDependencies).toHaveProperty("node-pty");
  });
});
