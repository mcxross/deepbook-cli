import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import https from "node:https"

const version = "v0.1.0"

const platform = os.platform()
const arch = os.arch()

let file = ""

if (platform === "linux" && arch === "x64") {
    file = "deepbook-terminal-linux-x64"
} else if (platform === "darwin" && arch === "arm64") {
    file = "deepbook-terminal-macos-arm64"
} else if (platform === "darwin" && arch === "x64") {
    file = "deepbook-terminal-macos-x64"
} else if (platform === "win32") {
    file = "deepbook-terminal-win-x64.exe"
} else {
    console.log("No Terminal binary for this platform")
    process.exit(0)
}

const url =
    `https://github.com/mcxross/deepbook-terminal/releases/download/${version}/${file}`

const outDir = path.join(
    process.cwd(),
    "node_modules",
    "deepbook-cli",
    "native"
)

fs.mkdirSync(outDir, { recursive: true })

const outPath = path.join(outDir, file)

console.log("Downloading DeepBook Terminal:", file)

https.get(url, res => {
    const fileStream = fs.createWriteStream(outPath)

    res.pipe(fileStream)

    fileStream.on("finish", () => {
        fs.chmodSync(outPath, 0o755)
        console.log("DeepBook Terminal installed")
    })
})