import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

export function runUI() {
    const dir = path.join(
        new URL(import.meta.url).pathname,
        "../../native"
    )

    const bin = path.join(
        dir,
        "deepbook-terminal-ui"
    )

    if (!fs.existsSync(bin)) {
        console.error("DeepBook Terminal not installed")
        process.exit(1)
    }

    spawnSync(bin, {
        stdio: "inherit"
    })
}