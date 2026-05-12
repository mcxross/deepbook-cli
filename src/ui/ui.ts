import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export function runUI() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageRoot = path.resolve(__dirname, "../..");
    const installedName = process.platform === "win32"
        ? "deepbook-terminal-ui.exe"
        : "deepbook-terminal-ui";
    const devName = process.platform === "win32" ? "strike.exe" : "strike";

    const installedBin = path.join(packageRoot, "native", installedName);
    const devBin = path.join(packageRoot, "tui", "target", "release", devName);
    const bin = fs.existsSync(installedBin) ? installedBin : devBin;

    if (!fs.existsSync(bin)) {
        console.error("DeepBook Terminal binary not found at:");
        console.error(installedBin);
        console.error("Build the local TUI with:");
        console.error("  cargo build --release --manifest-path tui/Cargo.toml");
        process.exit(1);
    }

    spawnSync(bin, {
        stdio: "inherit",
        env: { ...process.env }
    });
}
