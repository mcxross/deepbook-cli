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
    process.exit(0)
}

const url = `https://github.com/mcxross/deepbook-terminal/releases/download/${version}/${file}`

const nativeDir = path.resolve(process.cwd(), "native")
const archivePath = path.resolve(nativeDir, file)

if (!fs.existsSync(nativeDir)) {
    fs.mkdirSync(nativeDir, { recursive: true })
}

function download(downloadUrl) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'node.js',
                ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {})
            }
        }
        https.get(downloadUrl, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return download(res.headers.location).then(resolve).catch(reject)
            }
            if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`))

            const stream = fs.createWriteStream(archivePath)
            res.pipe(stream)
            stream.on("finish", () => stream.close(() => resolve()))
        }).on("error", reject)
    })
}

async function main() {
    try {
        await download(url)
        execSync(`tar -xzf "${archivePath}" -C "${nativeDir}"`)

        const strikePath = path.join(nativeDir, "strike")
        const finalPath = path.join(nativeDir, "deepbook-terminal-ui")

        if (fs.existsSync(strikePath)) {
            fs.renameSync(strikePath, finalPath)
        }

        fs.chmodSync(finalPath, 0o755)
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath)
        process.exit(0)
    } catch (err) {
        process.exit(1)
    }
}

main()