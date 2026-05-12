import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = "mcxross/deepbook-cli";
const STRICT_ENV = "DEEPBOOK_TERMINAL_INSTALL_STRICT";
const LOCAL_ARCHIVE_ENV = "DEEPBOOK_TERMINAL_ARCHIVE_PATH";
const BINARY_NAME = process.platform === "win32" ? "strike.exe" : "strike";
const FINAL_BINARY_NAME =
  process.platform === "win32"
    ? "deepbook-terminal-ui.exe"
    : "deepbook-terminal-ui";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const releaseTag = `v${String(packageJson.version).replace(/^v/, "")}`;

function strictInstall() {
  return Boolean(process.env[STRICT_ENV]);
}

function warnAndExit(message, error) {
  console.warn(`[deepbook-cli] ${message}`);
  if (error) {
    console.warn(`[deepbook-cli] ${error.message ?? String(error)}`);
  }
  if (strictInstall()) {
    process.exit(1);
  }
  process.exit(0);
}

function resolveAssetName() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === "darwin" && arch === "arm64") {
    return "deepbook-terminal-darwin-arm64.tar.gz";
  }
  if (platform === "darwin" && arch === "x64") {
    return "deepbook-terminal-darwin-amd64.tar.gz";
  }
  if (platform === "linux" && arch === "x64") {
    return "deepbook-terminal-linux-amd64.tar.gz";
  }
  if (platform === "linux" && arch === "arm64") {
    return "deepbook-terminal-linux-arm64.tar.gz";
  }
  if (platform === "win32" && arch === "x64") {
    return "deepbook-terminal-windows-amd64.zip";
  }

  return null;
}

function download(downloadUrl, destination) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "deepbook-cli postinstall",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    };

    https
      .get(downloadUrl, options, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return download(res.headers.location, destination)
            .then(resolve)
            .catch(reject);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const stream = fs.createWriteStream(destination);
        res.pipe(stream);
        stream.on("finish", () => stream.close(resolve));
        stream.on("error", reject);
      })
      .on("error", reject);
  });
}

function extractArchive(archivePath, nativeDir) {
  const tarArgs = archivePath.endsWith(".zip")
    ? ["-xf", archivePath, "-C", nativeDir]
    : ["-xzf", archivePath, "-C", nativeDir];

  execFileSync("tar", tarArgs, {
    stdio: "ignore",
  });

  const extractedBinaryPath = path.join(nativeDir, BINARY_NAME);
  const finalBinaryPath = path.join(nativeDir, FINAL_BINARY_NAME);

  if (!fs.existsSync(extractedBinaryPath)) {
    throw new Error(`Release archive did not contain ${BINARY_NAME}`);
  }

  if (fs.existsSync(finalBinaryPath)) {
    fs.rmSync(finalBinaryPath, { force: true });
  }

  fs.renameSync(extractedBinaryPath, finalBinaryPath);
  fs.chmodSync(finalBinaryPath, 0o755);
}

async function main() {
  const assetName = resolveAssetName();
  if (!assetName) {
    warnAndExit(
      `Skipping DeepBook Terminal install for unsupported platform ${os.platform()}/${os.arch()}.`,
    );
  }

  const nativeDir = path.join(packageRoot, "native");
  fs.mkdirSync(nativeDir, { recursive: true });

  const archivePath = path.join(nativeDir, assetName);
  const localArchivePath = process.env[LOCAL_ARCHIVE_ENV];

  try {
    if (localArchivePath) {
      fs.copyFileSync(localArchivePath, archivePath);
    } else {
      const url = `https://github.com/${REPO}/releases/download/${releaseTag}/${assetName}`;
      await download(url, archivePath);
    }

    extractArchive(archivePath, nativeDir);
    fs.rmSync(archivePath, { force: true });
  } catch (err) {
    warnAndExit("Skipping DeepBook Terminal native binary install.", err);
  }
}

main();
