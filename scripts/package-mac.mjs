// Local macOS preview bundle; this is not a notarized distribution build.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import mediaManifest from "../docs/media-runtime.json" with { type: "json" };

await import("./check-licenses.mjs");

if (process.platform !== "darwin") throw new Error("macOS is required.");
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageInfo = JSON.parse(
  await fs.readFile(path.join(base, "package.json"), "utf8"),
);
const release = path.join(base, "release");
const outputName = process.argv[2] || "Agentalk.app";
if (!/^Agentalk(?:-[a-z]+)?\.app$/.test(outputName)) {
  throw new Error(
    "The preview name must be Agentalk.app or Agentalk-<name>.app.",
  );
}
await fs.mkdir(release, { recursive: true });
const temporary = await fs.mkdtemp(path.join(release, ".agentalk-build-"));
const bundle = path.join(temporary, "Agentalk.app");
const copyOptions = {
  recursive: true,
  verbatimSymlinks: true,
  mode: constants.COPYFILE_FICLONE,
};
try {
  await fs.cp(
    path.join(base, "node_modules/electron/dist/Electron.app"),
    bundle,
    copyOptions,
  );
  const contents = path.join(bundle, "Contents");
  const resources = path.join(contents, "Resources");
  const application = path.join(resources, "app");
  await fs.mkdir(application, { recursive: true });
  for (const relative of [
    "electron",
    "dist",
    "public/brand",
    "src/locale.mjs",
    "src/message-layout.mjs",
    "src/locales",
    "package.json",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    const target = path.join(application, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.join(base, relative), target, copyOptions);
  }
  // Text extraction uses PDF.js without its optional native raster canvas.
  for (const dependency of ["fflate", "saxes", "xmlchars"]) {
    await fs.cp(
      path.join(base, "node_modules", dependency),
      path.join(application, "node_modules", dependency),
      copyOptions,
    );
  }
  for (const relative of [
    "package.json",
    "LICENSE",
    "legacy/build/pdf.mjs",
    "legacy/build/pdf.worker.mjs",
  ]) {
    const target = path.join(
      application,
      "node_modules",
      "pdfjs-dist",
      relative,
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(
      path.join(base, "node_modules", "pdfjs-dist", relative),
      target,
    );
  }
  const mediaBins = path.join(base, "vendor", "media", "bin");
  await fs.cp(
    mediaBins,
    path.join(application, "electron", "bin"),
    copyOptions,
  );
  await fs.cp(
    path.join(base, "docs", "licenses"),
    path.join(resources, "MediaLicenses"),
    copyOptions,
  );
  await fs.copyFile(
    path.join(base, "docs", "media-runtime.json"),
    path.join(resources, "MediaLicenses", "runtime.json"),
  );
  const mediaSources = path.join(resources, "MediaSources");
  await fs.mkdir(mediaSources, { recursive: true });
  for (const item of mediaManifest.sources) {
    const source = path.join(base, "vendor", "media", "sources", item.file);
    const hash = createHash("sha256")
      .update(await fs.readFile(source))
      .digest("hex");
    if (hash !== item.sha256)
      throw new Error(
        `Media source hash mismatch: ${item.file}. Run npm run media:setup.`,
      );
    await fs.copyFile(source, path.join(mediaSources, item.file));
  }
  await fs.copyFile(
    path.join(base, "docs", "MEDIA_SOURCES.md"),
    path.join(mediaSources, "README.md"),
  );
  await fs.copyFile(
    path.join(base, "docs", "MEDIA_BUILD.md"),
    path.join(mediaSources, "MEDIA_BUILD.md"),
  );
  await fs.copyFile(
    path.join(base, "scripts", "rebuild-media-mac.sh"),
    path.join(mediaSources, "rebuild-media-mac.sh"),
  );
  await fs.cp(
    path.join(base, "docs", "licenses"),
    path.join(mediaSources, "licenses"),
    copyOptions,
  );
  await fs.copyFile(
    path.join(base, "docs", "media-runtime.json"),
    path.join(mediaSources, "runtime.json"),
  );
  for (const name of ["ffmpeg", "ffprobe"]) {
    const binary = path.join(application, "electron", "bin", name);
    const config = execFileSync(binary, ["-buildconf"], { encoding: "utf8" });
    if (config.includes("--enable-nonfree") || config.includes("--enable-gpl"))
      throw new Error("Media runtime must use the configured LGPL build.");
    await fs.writeFile(
      path.join(mediaSources, `${name}-buildconf.txt`),
      config,
    );
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", binary]);
  }
  for (const name of ["LICENSE", "LICENSES.chromium.html"]) {
    await fs.copyFile(
      path.join(base, "node_modules/electron/dist", name),
      path.join(resources, name),
    );
  }
  await fs.copyFile(
    path.join(base, "public/brand/agentalk.icns"),
    path.join(resources, "Agentalk.icns"),
  );
  await fs.rename(
    path.join(contents, "MacOS/Electron"),
    path.join(contents, "MacOS/Agentalk"),
  );
  const plist = path.join(contents, "Info.plist");
  const values = {
    CFBundleDisplayName: "Agentalk",
    CFBundleName: "Agentalk",
    CFBundleExecutable: "Agentalk",
    CFBundleIdentifier: "local.agentalk.desktop",
    CFBundleIconFile: "Agentalk.icns",
    CFBundleShortVersionString: packageInfo.version,
    CFBundleVersion: packageInfo.version,
    LSApplicationCategoryType: "public.app-category.productivity",
  };
  for (const [key, value] of Object.entries(values)) {
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :${key} ${value}`,
      plist,
    ]);
  }
  // Each helper is its own macOS bundle. Keep its name, executable and ID
  // consistent with the parent, as required by Electron's packaging guide.
  for (const [suffix, identifier] of [
    ["", "helper"],
    [" (GPU)", "helper.GPU"],
    [" (Plugin)", "helper.Plugin"],
    [" (Renderer)", "helper.Renderer"],
  ]) {
    const oldName = `Electron Helper${suffix}`;
    const newName = `Agentalk Helper${suffix}`;
    const oldBundle = path.join(contents, "Frameworks", `${oldName}.app`);
    const helperPlist = path.join(oldBundle, "Contents", "Info.plist");
    for (const [key, value] of Object.entries({
      CFBundleName: newName,
      CFBundleIdentifier: `local.agentalk.desktop.${identifier}`,
    })) {
      execFileSync("/usr/libexec/PlistBuddy", [
        "-c",
        `Set :${key} ${value}`,
        helperPlist,
      ]);
    }
    for (const [key, value] of Object.entries({
      CFBundleDisplayName: newName,
      CFBundleExecutable: newName,
    })) {
      execFileSync("/usr/libexec/PlistBuddy", [
        "-c",
        `Add :${key} string ${value}`,
        helperPlist,
      ]);
    }
    await fs.rename(
      path.join(oldBundle, "Contents", "MacOS", oldName),
      path.join(oldBundle, "Contents", "MacOS", newName),
    );
    await fs.rename(
      oldBundle,
      path.join(contents, "Frameworks", `${newName}.app`),
    );
  }
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Delete :ElectronAsarIntegrity",
    plist,
  ]);
  await fs.rm(path.join(resources, "default_app.asar"));
  execFileSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--preserve-metadata=entitlements,flags,runtime",
      bundle,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", bundle],
    { stdio: "inherit" },
  );
  const destination = path.join(release, outputName);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(bundle, destination);
  console.log(`Local preview ready: ${destination}`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
