import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

export function runUI() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const bin = path.resolve(__dirname, "../native/deepbook-terminal-ui");

    if (!fs.existsSync(bin)) {
        console.error(`DeepBook Terminal binary not found at: ${bin}`);
        process.exit(1);
    }

    spawnSync(bin, {
        stdio: "inherit"
    });
}