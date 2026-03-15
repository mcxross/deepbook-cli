import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

export function runUI() {
    const platform = os.platform()

    let bin = ""

    if (platform === "darwin") {
        bin = "strike"
    } else if (platform === "linux") {
        bin = "strike"
    } else if (platform === "win32") {
        bin = "strike.exe"
    } else {
        console.error("Unsupported platform")
        process.exit(1)
    }

    const binPath = path.join(
        new URL(import.meta.url).pathname,
        "../../native",
        bin
    )

    spawnSync(binPath, {
        stdio: "inherit"
    })
}