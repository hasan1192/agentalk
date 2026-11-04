import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import manifest from "../docs/media-runtime.json" with { type: "json" };
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asset = manifest.assets[`${process.platform}-${process.arch}`];
if (!asset || asset.supported === false)
  throw new Error("No media runtime is configured for this platform.");
const root = path.join(base, "vendor", "media");
const bin = path.join(root, "bin");
await fs.mkdir(bin, { recursive: true });
const archive = path.join(
  root,
  asset.url?.endsWith("zip") ? "runtime.zip" : "runtime.tar.gz",
);
async function download(item, destination) {
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  try {
    if (hash(await fs.readFile(destination)) === item.sha256) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let bytes;
  try {
    const response = await fetch(item.url, {
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok)
      throw new Error(`Media download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    // Some hosted Windows networks time out on Node's chosen route. Keep TLS
    // verification and the same pinned URL/hash, and retry over IPv4 with curl.
    if (/HTTP (?:400|401|403|404|406)/.test(error.message)) throw error;
    bytes = execFileSync(
      "curl",
      [
        "--ipv4",
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "30",
        "--max-time",
        "180",
        "--retry",
        "3",
        "--retry-all-errors",
        item.url,
      ],
      { maxBuffer: 192 * 1024 * 1024 },
    );
  }
  if (hash(bytes) !== item.sha256)
    throw new Error("Media archive SHA-256 mismatch.");
  await fs.writeFile(destination, bytes);
}
const sourcesOnly = process.argv.includes("--sources-only");
const buildNative =
  process.platform === "win32" || process.platform === "linux";
if (!sourcesOnly && !buildNative) {
  await download(asset, archive);
  const entries = execFileSync("tar", ["-tf", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  if (entries.some((entry) => !/^(ffmpeg|ffprobe)(\.exe)?$/.test(entry)))
    throw new Error("Unexpected media archive content.");
  execFileSync("tar", ["-xf", archive, "-C", bin]);
  for (const name of ["ffmpeg", "ffprobe"]) {
    const file = path.join(
      bin,
      name + (process.platform === "win32" ? ".exe" : ""),
    );
    const config = execFileSync(file, ["-buildconf"], { encoding: "utf8" });
    if (config.includes("--enable-nonfree") || config.includes("--enable-gpl"))
      throw new Error("Media build contains restricted components.");
  }
}
const sources = path.join(root, "sources");
await fs.mkdir(sources, { recursive: true });
const sourcesForBuild = buildNative
  ? manifest.sources.filter((item) =>
      manifest.nativeSources.includes(item.file),
    )
  : manifest.sources;
await Promise.all(
  sourcesForBuild.map((item) => download(item, path.join(sources, item.file))),
);
// The upstream builder's archive has no license for its scripts. Supply our
// independent rebuild procedure together with the licensed codec sources.
await fs.rm(path.join(sources, "build-source.tar.gz"), { force: true });
for (const [relative, name] of [
  ["docs/MEDIA_SOURCES.md", "README.md"],
  ["docs/MEDIA_BUILD.md", "MEDIA_BUILD.md"],
  ["scripts/rebuild-media-mac.sh", "rebuild-media-mac.sh"],
  ["scripts/rebuild-media-portable.sh", "rebuild-media-portable.sh"],
  ["docs/media-runtime.json", "runtime.json"],
]) {
  await fs.copyFile(path.join(base, relative), path.join(sources, name));
}
await fs.cp(path.join(base, "docs/licenses"), path.join(sources, "licenses"), {
  recursive: true,
});
await fs.copyFile(
  path.join(base, "docs", "media-runtime.json"),
  path.join(root, "runtime.json"),
);
if (!sourcesOnly && buildNative) {
  const build = await fs.mkdtemp(path.join(root, "build-"));
  try {
    const shellPath = (file) =>
      process.platform === "win32"
        ? execFileSync("cygpath", ["-u", file], { encoding: "utf8" }).trim()
        : file;
    execFileSync(
      "bash",
      [
        path.join(base, "scripts/rebuild-media-portable.sh"),
        sources,
        build,
        bin,
      ].map(shellPath),
      { stdio: "inherit" },
    );
  } finally {
    await fs.rm(build, { recursive: true, force: true });
  }
}
console.log(
  sourcesOnly
    ? `Verified media sources ready: ${sources}`
    : `Media runtime ${manifest.version} ready: ${bin}`,
);
