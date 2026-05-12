import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";

export const DEEPBOOK_CLI_PACKAGE_NAME = "deepbook-cli";
export const DEEPBOOK_UPDATE_CHECK_DISABLED_ENV =
  "DEEPBOOK_DISABLE_UPDATE_CHECK";
export const DEEPBOOK_UPDATE_CHECK_LATEST_VERSION_ENV =
  "DEEPBOOK_UPDATE_CHECK_LATEST_VERSION";
export const DEEPBOOK_UPDATE_STATE_PATH = join(
  ".deepbook",
  "update-check.json",
);
export const UPDATE_SNOOZE_HOURS = 8;
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
export const SUPPORTED_SELF_UPDATE_PACKAGE_MANAGERS = [
  "npm",
  "pnpm",
  "bun",
] as const;

export type SelfUpdatePackageManager =
  (typeof SUPPORTED_SELF_UPDATE_PACKAGE_MANAGERS)[number];

export interface SelfUpdateOptions {
  version?: string;
  packageManager?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export interface SelfUpdatePlan {
  packageName: string;
  currentVersion: string;
  target: string;
  packageManager: SelfUpdatePackageManager;
  command: string;
  args: string[];
}

export interface UpdatePromptState {
  ignoredVersion?: string;
  snoozeUntilMs?: number;
}

export interface ShouldPromptForUpdateInput {
  currentVersion: string;
  latestVersion: string;
  nowMs: number;
  state?: UpdatePromptState;
}

export interface MaybePromptForUpdateOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  input?: InteractiveInput;
  output?: InteractiveOutput;
  fetchLatestVersion?: () => Promise<string>;
  readState?: () => UpdatePromptState;
  writeState?: (state: UpdatePromptState) => void;
  runUpdate?: (
    currentVersion: string,
    options: SelfUpdateOptions,
  ) => Promise<SelfUpdatePlan>;
  nowMs?: () => number;
}

type InteractiveInput = Readable & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
};

type InteractiveOutput = Writable & { isTTY?: boolean };

export function resolveSelfUpdatePackageManager(
  input?: string,
): SelfUpdatePackageManager {
  const raw = input?.trim() || process.env.DEEPBOOK_UPDATE_PACKAGE_MANAGER || "npm";
  const normalized = raw.trim().toLowerCase();
  if (
    SUPPORTED_SELF_UPDATE_PACKAGE_MANAGERS.includes(
      normalized as SelfUpdatePackageManager,
    )
  ) {
    return normalized as SelfUpdatePackageManager;
  }

  throw new Error(
    `Invalid package manager "${raw}". Supported values: ${SUPPORTED_SELF_UPDATE_PACKAGE_MANAGERS.join(", ")}.`,
  );
}

export function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  const latest = parseVersion(latestVersion);
  const current = parseVersion(currentVersion);

  if (!latest || !current) {
    return latestVersion.trim() !== currentVersion.trim();
  }

  for (let i = 0; i < 3; i += 1) {
    if (latest[i] > current[i]) {
      return true;
    }
    if (latest[i] < current[i]) {
      return false;
    }
  }

  return false;
}

export function shouldPromptForUpdate({
  currentVersion,
  latestVersion,
  nowMs,
  state = {},
}: ShouldPromptForUpdateInput): boolean {
  if (!isNewerVersion(latestVersion, currentVersion)) {
    return false;
  }

  if (state.ignoredVersion === latestVersion) {
    return false;
  }

  if (typeof state.snoozeUntilMs === "number" && state.snoozeUntilMs > nowMs) {
    return false;
  }

  return true;
}

export async function fetchLatestDeepbookCliVersion(): Promise<string> {
  const override = process.env[DEEPBOOK_UPDATE_CHECK_LATEST_VERSION_ENV]?.trim();
  if (override) {
    return override;
  }

  const stdout = await execFileText("npm", [
    "view",
    DEEPBOOK_CLI_PACKAGE_NAME,
    "version",
  ]);
  return stdout.trim();
}

export function createSelfUpdatePlan(
  currentVersion: string,
  options: SelfUpdateOptions = {},
): SelfUpdatePlan {
  const packageManager = resolveSelfUpdatePackageManager(options.packageManager);
  const targetVersion = options.version?.trim() || "latest";
  const target = `${DEEPBOOK_CLI_PACKAGE_NAME}@${targetVersion}`;

  switch (packageManager) {
    case "npm":
      return {
        packageName: DEEPBOOK_CLI_PACKAGE_NAME,
        currentVersion,
        target,
        packageManager,
        command: commandForPlatform("npm"),
        args: ["install", "-g", target],
      };
    case "pnpm":
      return {
        packageName: DEEPBOOK_CLI_PACKAGE_NAME,
        currentVersion,
        target,
        packageManager,
        command: commandForPlatform("pnpm"),
        args: ["add", "-g", target],
      };
    case "bun":
      return {
        packageName: DEEPBOOK_CLI_PACKAGE_NAME,
        currentVersion,
        target,
        packageManager,
        command: commandForPlatform("bun"),
        args: ["add", "-g", target],
      };
  }
}

export async function runSelfUpdate(
  currentVersion: string,
  options: SelfUpdateOptions = {},
): Promise<SelfUpdatePlan> {
  const plan = createSelfUpdatePlan(currentVersion, options);

  if (options.dryRun) {
    return plan;
  }

  if (!options.yes) {
    console.log(`Current version: ${plan.currentVersion}`);
    console.log(`Target package:  ${plan.target}`);
    console.log(`Package manager: ${plan.packageManager}`);
    console.log("");
  }

  await spawnSelfUpdate(plan);
  return plan;
}

export async function maybePromptForUpdate(
  currentVersion: string,
  options: MaybePromptForUpdateOptions = {},
): Promise<boolean> {
  const args = options.args ?? process.argv;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const nowMs = options.nowMs ?? Date.now;

  if (
    !shouldRunInteractiveUpdateCheck(args, {
      env: options.env,
      input,
      output,
    })
  ) {
    return false;
  }

  let latestVersion: string;
  try {
    latestVersion = await (
      options.fetchLatestVersion ?? fetchLatestDeepbookCliVersion
    )();
  } catch {
    return false;
  }

  const state = (options.readState ?? readUpdatePromptState)();
  if (
    !shouldPromptForUpdate({
      currentVersion,
      latestVersion,
      nowMs: nowMs(),
      state,
    })
  ) {
    return false;
  }

  const choice = await promptForUpdateChoice(currentVersion, latestVersion, {
    input,
    output,
  });
  switch (choice) {
    case "update":
      await (options.runUpdate ?? runSelfUpdate)(currentVersion, {
        version: latestVersion,
        yes: true,
      });
      return true;
    case "later":
      (options.writeState ?? writeUpdatePromptState)({
        ignoredVersion:
          state.ignoredVersion === latestVersion ? undefined : state.ignoredVersion,
        snoozeUntilMs: nowMs() + UPDATE_SNOOZE_HOURS * 60 * 60 * 1000,
      });
      return false;
    case "ignore":
      (options.writeState ?? writeUpdatePromptState)({
        ignoredVersion: latestVersion,
      });
      return false;
  }
}

export function readUpdatePromptState(homeDirectory = homedir()): UpdatePromptState {
  const path = resolveUpdateStatePath(homeDirectory);
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as UpdatePromptState;
    return {
      ignoredVersion:
        typeof parsed.ignoredVersion === "string"
          ? parsed.ignoredVersion
          : undefined,
      snoozeUntilMs:
        typeof parsed.snoozeUntilMs === "number" ? parsed.snoozeUntilMs : undefined,
    };
  } catch {
    return {};
  }
}

export function writeUpdatePromptState(
  state: UpdatePromptState,
  homeDirectory = homedir(),
): void {
  const path = resolveUpdateStatePath(homeDirectory);
  const temporaryPath = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

export function shouldRunInteractiveUpdateCheck(
  args = process.argv,
  options: {
    env?: NodeJS.ProcessEnv;
    input?: { isTTY?: boolean };
    output?: { isTTY?: boolean };
  } = {},
): boolean {
  const env = options.env ?? process.env;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  if (env[DEEPBOOK_UPDATE_CHECK_DISABLED_ENV]) {
    return false;
  }

  if (!input.isTTY || !output.isTTY) {
    return false;
  }

  const rawArgs = args.slice(2);
  if (
    rawArgs.some((arg) =>
      ["--json", "--help", "-h", "--version", "-V"].includes(arg),
    )
  ) {
    return false;
  }

  if (rawArgs.includes("update")) {
    return false;
  }

  return true;
}

async function spawnSelfUpdate(plan: SelfUpdatePlan): Promise<void> {
  const code = await spawnAndWait(plan.command, plan.args);
  if (code === 0) {
    return;
  }

  if (process.platform !== "win32" && plan.packageManager === "npm") {
    console.error("");
    console.error(
      "Update failed. If this is a global npm permission issue, retrying with sudo.",
    );
    const sudoCode = await spawnAndWait("sudo", [plan.command, ...plan.args]);
    if (sudoCode === 0) {
      return;
    }
    throw new Error(`sudo update failed with exit code ${sudoCode}.`);
  }

  throw new Error(`self update failed with exit code ${code}.`);
}

function spawnAndWait(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", resolve);
  });
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}

function commandForPlatform(command: string): string {
  if (process.platform === "win32") {
    return `${command}.cmd`;
  }
  return command;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  ];
}

function resolveUpdateStatePath(homeDirectory: string): string {
  return join(homeDirectory, DEEPBOOK_UPDATE_STATE_PATH);
}

type UpdatePromptChoice = "update" | "later" | "ignore";

async function promptForUpdateChoice(
  currentVersion: string,
  latestVersion: string,
  streams: {
    input: InteractiveInput;
    output: InteractiveOutput;
  },
): Promise<UpdatePromptChoice> {
  const choices: Array<{
    label: string;
    value: UpdatePromptChoice;
  }> = [
    {
      label: `Update now (runs \`npm install -g ${DEEPBOOK_CLI_PACKAGE_NAME}\`)`,
      value: "update",
    },
    {
      label: `Update in ${UPDATE_SNOOZE_HOURS} hours`,
      value: "later",
    },
    {
      label: "Ignore this version",
      value: "ignore",
    },
  ];

  let selectedIndex = 0;
  readline.emitKeypressEvents(streams.input);

  if (streams.input.isTTY && streams.input.setRawMode) {
    streams.input.setRawMode(true);
  }

  function render() {
    streams.output.write("\x1Bc");
    streams.output.write(
      `\n${BOLD}Update available${RESET} ${GRAY}${currentVersion} -> ${latestVersion}${RESET}\n\n`,
    );

    choices.forEach((choice, index) => {
      const active = index === selectedIndex;
      const pointer = active ? `${CYAN}>${RESET}` : " ";
      const color = active ? CYAN : WHITE;
      streams.output.write(`${pointer} ${index + 1}. ${color}${choice.label}${RESET}\n`);
    });

    streams.output.write(`\n${GRAY}Use arrow keys, 1-3, then press enter${RESET}`);
  }

  return await new Promise<UpdatePromptChoice>((resolve) => {
    const onKeypress = (_str: string, key: readline.Key) => {
      if (key.name === "up") {
        selectedIndex =
          selectedIndex === 0 ? choices.length - 1 : selectedIndex - 1;
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex =
          selectedIndex === choices.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }

      if (key.name === "1") {
        selectedIndex = 0;
        render();
        return;
      }

      if (key.name === "2") {
        selectedIndex = 1;
        render();
        return;
      }

      if (key.name === "3") {
        selectedIndex = 2;
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(choices[selectedIndex].value);
        return;
      }

      if (key.name === "escape") {
        cleanup();
        resolve("later");
        return;
      }

      if (key.name === "c" && key.ctrl) {
        cleanup();
        process.exit(130);
      }
    };

    function cleanup() {
      streams.input.off("keypress", onKeypress);

      if (streams.input.isTTY && streams.input.setRawMode) {
        streams.input.setRawMode(false);
      }

      streams.output.write("\n");
    }

    streams.input.on("keypress", onKeypress);
    render();
  });
}
