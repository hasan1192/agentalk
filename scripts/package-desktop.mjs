import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyResources } from "./package-resources.mjs";

await import("./check-licenses.mjs");
if (!["win32", "linux"].includes(process.platform)) {
  throw new Error(
    "Run this packager on Windows or Linux. Use package:mac on macOS.",
  );
}
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(base, "release");
const directory = `Agentalk-${process.platform}-${process.arch}`;
await fs.mkdir(release, { recursive: true });
const temporary = await fs.mkdtemp(path.join(release, ".agentalk-build-"));
try {
  const bundle = path.join(temporary, directory);
  await fs.cp(path.join(base, "node_modules/electron/dist"), bundle, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const resources = path.join(bundle, "resources");
  await fs.rm(path.join(resources, "default_app.asar"));
  await copyResources(base, resources);
  const windows = process.platform === "win32";
  const executable = windows ? "Agentalk.exe" : "agentalk";
  await fs.rename(
    path.join(bundle, windows ? "electron.exe" : "electron"),
    path.join(bundle, executable),
  );
  if (windows) {
    const crashHelper = path.join(bundle, "electron_wer.dll");
    if (await fs.stat(crashHelper).catch(() => null)) {
      await fs.rename(crashHelper, path.join(bundle, "Agentalk_wer.dll"));
    }
  } else {
    await fs.chmod(path.join(bundle, executable), 0o755);
  }
  await fs.writeFile(
    path.join(bundle, "README.txt"),
    [
      "Agentalk alpha — portable package",
      `Extract the complete archive, then run ${executable}. Keep all files together.`,
      "No Node.js or separate FFmpeg installation is needed.",
      "The application is unsigned. This is an early alpha release.",
      windows
        ? ""
        : "A desktop session, Electron system libraries and working Chromium sandbox support are required.",
      "Linux API keys require a supported OS keyring; plaintext storage is refused.",
      "Third-party notices and matching FFmpeg sources are included in resources/.",
      "https://github.com/hasan1192/agentalk",
      "",
    ].join("\n"),
  );
  const destination = path.join(release, directory);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(bundle, destination);
  await fs.writeFile(
    path.join(release, "package-info.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        directory,
        executable,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Portable package ready: ${destination}`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
