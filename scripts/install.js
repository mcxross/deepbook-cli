import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import { execSync } from "node:child_process"

const version = "v0.1.0"

const platform = os.platform()
const arch = os.arch()

let file = ""

if (platform === "darwin" && arch === "arm64") {
    file = "deepbook-terminal-darwin-arm64.tar.gz"
} else if (platform === "darwin" && arch === "x64") {
    file = "deepbook-terminal-darwin-amd64.tar.gz"
} else if (platform === "linux" && arch === "x64") {
    file = "deepbook-terminal-linux-amd64.tar.gz"
} else if (platform === "linux" && arch === "arm64") {
    file = "deepbook-terminal-linux-arm64.tar.gz"
} else {
    console.log("No binary for this platform")
    process.exit(0)
}

const url =
    `https://github.com/mcxross/deepbook-terminal/releases/download/${version}/${file}`

const baseDir = path.join(
    process.cwd(),
    "node_modules",
    "deepbook-cli"
)

const nativeDir = path.join(baseDir, "native")

fs.mkdirSync(nativeDir, { recursive: true })

const archivePath = path.join(nativeDir, file)

console.log("Downloading:", file)

https.get(url, res => {
    const stream = fs.createWriteStream(archivePath)

    res.pipe(stream)

    stream.on("finish", () => {
        console.log("Extracting...")

        execSync(
            `tar -xzf ${archivePath} -C ${nativeDir}`
        )

        const strikePath = path.join(nativeDir, "strike")

        if (!fs.existsSync(strikePath)) {
            console.error("strike binary not found")
            process.exit(1)
        }

        const finalPath = path.join(
            nativeDir,
            "deepbook-terminal-ui"
        )

        fs.renameSync(strikePath, finalPath)

        fs.chmodSync(finalPath, 0o755)

        console.log("Installed DeepBook Terminal:", finalPath)
    })
})