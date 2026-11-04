import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(base, "release");
const info = JSON.parse(
  await fs.readFile(path.join(release, "package-info.json"), "utf8"),
);
const expectedDirectory = `Agentalk-${process.platform}-${process.arch}`;
const expectedExecutable =
  process.platform === "win32" ? "Agentalk.exe" : "agentalk";
if (
  !["win32", "linux"].includes(process.platform) ||
  info.platform !== process.platform ||
  info.arch !== process.arch ||
  info.directory !== expectedDirectory ||
  info.executable !== expectedExecutable
) {
  throw new Error("Package does not match this host.");
}
const bundle = path.join(release, info.directory);
if (process.argv[2] === "test") {
  const result = spawnSync(
    process.execPath,
    [path.join(base, "scripts/smoke.mjs")],
    {
      cwd: base,
      stdio: "inherit",
      env: {
        ...process.env,
        AGENTALK_TEST_EXECUTABLE: path.join(bundle, info.executable),
      },
    },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
if (process.argv[2] !== "archive") throw new Error("Choose test or archive.");
const { version } = JSON.parse(
  await fs.readFile(path.join(base, "package.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
  throw new Error("Invalid release version.");
const name = `Agentalk-${version}-${process.platform === "win32" ? "windows" : "linux"}-${process.arch}`;
const filename = name + (process.platform === "win32" ? ".zip" : ".tar.gz");
const destination = path.join(release, filename);
await fs.rm(destination, { force: true });
if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath $env:AGENTALK_ARCHIVE_SOURCE -DestinationPath $env:AGENTALK_ARCHIVE_DESTINATION -CompressionLevel Optimal",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        AGENTALK_ARCHIVE_SOURCE: bundle,
        AGENTALK_ARCHIVE_DESTINATION: destination,
      },
    },
  );
} else {
  execFileSync("tar", ["-czf", destination, "-C", release, info.directory], {
    stdio: "inherit",
  });
}
const hash = createHash("sha256")
  .update(await fs.readFile(destination))
  .digest("hex");
await fs.writeFile(destination + ".sha256", `${hash}  ${filename}\n`);
console.log(`Release archive ready: ${filename}`);
