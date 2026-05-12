import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  createSelfUpdatePlan,
  isNewerVersion,
  maybePromptForUpdate,
  readUpdatePromptState,
  resolveSelfUpdatePackageManager,
  type SelfUpdateOptions,
  type SelfUpdatePlan,
  shouldPromptForUpdate,
  writeUpdatePromptState,
} from "../src/self-update.js";

describe("self update planning", () => {
  it("defaults to npm global install of the latest package", () => {
    const plan = createSelfUpdatePlan("0.1.6");

    expect(plan.currentVersion).toBe("0.1.6");
    expect(plan.target).toBe("deepbook-cli@latest");
    expect(plan.packageManager).toBe("npm");
    expect(plan.args).toEqual(["install", "-g", "deepbook-cli@latest"]);
  });

  it("supports explicit versions and alternate package managers", () => {
    const plan = createSelfUpdatePlan("0.1.6", {
      version: "0.2.0",
      packageManager: "pnpm",
    });

    expect(plan.target).toBe("deepbook-cli@0.2.0");
    expect(plan.packageManager).toBe("pnpm");
    expect(plan.args).toEqual(["add", "-g", "deepbook-cli@0.2.0"]);
  });

  it("rejects unsupported package managers", () => {
    expect(() => resolveSelfUpdatePackageManager("yarn")).toThrow(
      /Supported values: npm, pnpm, bun/,
    );
  });

  it("compares semantic versions", () => {
    expect(isNewerVersion("0.1.7", "0.1.6")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.99")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.1.6", "0.1.6")).toBe(false);
    expect(isNewerVersion("0.1.5", "0.1.6")).toBe(false);
  });

  it("prompts only when the latest version is newer and not suppressed", () => {
    expect(
      shouldPromptForUpdate({
        currentVersion: "0.1.6",
        latestVersion: "0.1.7",
        nowMs: 1_000,
      }),
    ).toBe(true);

    expect(
      shouldPromptForUpdate({
        currentVersion: "0.1.6",
        latestVersion: "0.1.7",
        nowMs: 1_000,
        state: { ignoredVersion: "0.1.7" },
      }),
    ).toBe(false);

    expect(
      shouldPromptForUpdate({
        currentVersion: "0.1.6",
        latestVersion: "0.1.7",
        nowMs: 1_000,
        state: { snoozeUntilMs: 2_000 },
      }),
    ).toBe(false);

    expect(
      shouldPromptForUpdate({
        currentVersion: "0.1.7",
        latestVersion: "0.1.7",
        nowMs: 1_000,
      }),
    ).toBe(false);
  });

  it("persists prompt state under the deepbook home directory", () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), "deepbook-update-"));
    try {
      writeUpdatePromptState(
        { ignoredVersion: "0.1.7", snoozeUntilMs: 2_000 },
        homeDirectory,
      );

      expect(readUpdatePromptState(homeDirectory)).toEqual({
        ignoredVersion: "0.1.7",
        snoozeUntilMs: 2_000,
      });
    } finally {
      rmSync(homeDirectory, { recursive: true, force: true });
    }
  });

  it("runs the updater when an interactive prompt chooses update now", async () => {
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    output.isTTY = true;

    const updates: Array<{
      currentVersion: string;
      options: SelfUpdateOptions;
    }> = [];

    const updatePromise = maybePromptForUpdate("0.1.6", {
      args: ["node", "deepbook", "pools"],
      env: {},
      input,
      output,
      fetchLatestVersion: async () => "0.1.7",
      readState: () => ({}),
      writeState: () => {
        throw new Error("update-now should not write snooze state");
      },
      runUpdate: async (
        currentVersion: string,
        options: SelfUpdateOptions,
      ): Promise<SelfUpdatePlan> => {
        updates.push({ currentVersion, options });
        return createSelfUpdatePlan(currentVersion, {
          ...options,
          dryRun: true,
        });
      },
      nowMs: () => 1_000,
    });

    input.write("1\n");

    await expect(updatePromise).resolves.toBe(true);
    expect(updates).toEqual([
      {
        currentVersion: "0.1.6",
        options: { version: "0.1.7", yes: true },
      },
    ]);
  });
});
