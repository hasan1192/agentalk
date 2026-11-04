import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Copy application inputs explicitly. Never package the development checkout,
// test profiles, exports, credentials or generated screenshots.
export async function copyResources(
  base,
  resources,
  platform = process.platform,
  run = execFileSync,
) {
  const copy = async (relative, target) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.join(base, relative), target, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) =>
        ![".DS_Store", ".git"].includes(path.basename(source)),
    });
  };
  const application = path.join(resources, "app");
  await fs.mkdir(application, { recursive: true });
  for (const name of await fs.readdir(path.join(base, "electron"))) {
    if (!/\.(mjs|cjs)$/.test(name)) continue;
    const source = path.join(base, "electron", name);
    if (!(await fs.lstat(source)).isFile())
      throw new Error("Invalid app source.");
    await copy(`electron/${name}`, path.join(application, "electron", name));
  }
  for (const relative of [
    "dist/index.html",
    "public/brand",
    "src/locale.mjs",
    "src/message-layout.mjs",
    "src/locales",
    "package.json",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    await copy(relative, path.join(application, relative));
  }
  for (const name of await fs.readdir(path.join(base, "dist", "assets"))) {
    if (!/\.(js|css)$/.test(name)) continue;
    await copy(
      `dist/assets/${name}`,
      path.join(application, "dist/assets", name),
    );
  }
  for (const dependency of ["fflate", "saxes", "xmlchars"]) {
    await copy(
      `node_modules/${dependency}`,
      path.join(application, "node_modules", dependency),
    );
  }
  for (const relative of [
    "package.json",
    "LICENSE",
    "legacy/build/pdf.mjs",
    "legacy/build/pdf.worker.mjs",
  ]) {
    await copy(
      `node_modules/pdfjs-dist/${relative}`,
      path.join(application, "node_modules/pdfjs-dist", relative),
    );
  }

  const manifest = JSON.parse(
    await fs.readFile(path.join(base, "docs/media-runtime.json"), "utf8"),
  );
  const mediaSources = path.join(resources, "MediaSources");
  await fs.mkdir(mediaSources, { recursive: true });
  for (const item of manifest.sources) {
    if (path.basename(item.file) !== item.file)
      throw new Error("Invalid media source filename.");
    const data = await fs.readFile(
      path.join(base, "vendor/media/sources", item.file),
    );
    if (createHash("sha256").update(data).digest("hex") !== item.sha256) {
      throw new Error(
        `Media source hash mismatch: ${item.file}. Run npm run media:setup.`,
      );
    }
    await fs.writeFile(path.join(mediaSources, item.file), data);
  }
  for (const [relative, name] of [
    ["docs/MEDIA_SOURCES.md", "README.md"],
    ["docs/MEDIA_BUILD.md", "MEDIA_BUILD.md"],
    ["scripts/rebuild-media-mac.sh", "rebuild-media-mac.sh"],
    ["scripts/rebuild-media-portable.sh", "rebuild-media-portable.sh"],
    ["docs/media-runtime.json", "runtime.json"],
  ]) {
    await copy(relative, path.join(mediaSources, name));
  }
  await copy("docs/licenses", path.join(mediaSources, "licenses"));
  await copy("docs/licenses", path.join(resources, "MediaLicenses"));
  await copy(
    "docs/media-runtime.json",
    path.join(resources, "MediaLicenses/runtime.json"),
  );
  for (const name of ["ffmpeg", "ffprobe"]) {
    const filename = name + (platform === "win32" ? ".exe" : "");
    const target = path.join(application, "electron/bin", filename);
    await copy(`vendor/media/bin/${filename}`, target);
    if (platform !== "win32") await fs.chmod(target, 0o755);
    const config = run(target, ["-buildconf"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (/--enable-(?:gpl|nonfree|version3)(?:\s|$)/.test(config)) {
      throw new Error("Media runtime must use the configured LGPL build.");
    }
    await fs.writeFile(
      path.join(mediaSources, `${name}-buildconf.txt`),
      config,
    );
  }
  for (const name of ["LICENSE", "LICENSES.chromium.html"]) {
    await copy(
      `node_modules/electron/dist/${name}`,
      path.join(resources, name),
    );
  }
}
