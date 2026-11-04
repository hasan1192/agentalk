import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { copyResources } from "../scripts/package-resources.mjs";

async function fixture(t) {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "agentalk-package-test-"),
  );
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const base = path.join(temporary, "source");
  const resources = path.join(temporary, "bundle/resources");
  const write = async (relative, content = "synthetic fixture") => {
    const file = path.join(base, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  for (const relative of [
    "electron/main.mjs",
    "electron/preload.cjs",
    "dist/index.html",
    "dist/assets/app.js",
    "dist/assets/app.css",
    "public/brand/icon.png",
    "src/locale.mjs",
    "src/message-layout.mjs",
    "src/locales/en.json",
    "package.json",
    "THIRD_PARTY_NOTICES.md",
    "docs/licenses/notice.txt",
    "docs/MEDIA_SOURCES.md",
    "docs/MEDIA_BUILD.md",
    "scripts/rebuild-media-mac.sh",
    "scripts/rebuild-media-portable.sh",
    "node_modules/electron/dist/LICENSE",
    "node_modules/electron/dist/LICENSES.chromium.html",
    ...["fflate", "saxes", "xmlchars"].map(
      (name) => `node_modules/${name}/package.json`,
    ),
    ...[
      "package.json",
      "LICENSE",
      "legacy/build/pdf.mjs",
      "legacy/build/pdf.worker.mjs",
    ].map((name) => `node_modules/pdfjs-dist/${name}`),
    "vendor/media/bin/ffmpeg",
    "vendor/media/bin/ffprobe",
    "vendor/media/bin/ffmpeg.exe",
    "vendor/media/bin/ffprobe.exe",
    ".env",
    ".git/config",
    "workspace/_system/events.jsonl",
    "docs/private/notes.md",
    "electron/vault.json",
    "electron/events.jsonl",
    "dist/assets/app.js.map",
    "artifacts/private.png",
  ])
    await write(relative);
  const source = "matching synthetic media source archive";
  await write("vendor/media/sources/source.tar.gz", source);
  await write(
    "docs/media-runtime.json",
    JSON.stringify({
      sources: [
        {
          file: "source.tar.gz",
          sha256: createHash("sha256").update(source).digest("hex"),
        },
      ],
    }),
  );
  return { base, resources, write };
}

test("portable package excludes credentials, conversations, test artifacts and source maps", async (t) => {
  const { base, resources } = await fixture(t);
  await copyResources(
    base,
    resources,
    "linux",
    () => "--disable-gpl --disable-nonfree",
  );
  const entries = await fs.readdir(resources, { recursive: true });
  for (const forbidden of [
    ".env",
    ".git",
    "workspace",
    "events.jsonl",
    "vault.json",
    "notes.md",
    "private.png",
    "app.js.map",
  ]) {
    assert(
      !entries.some((entry) => entry.split(path.sep).includes(forbidden)),
      forbidden,
    );
  }
  for (const required of [
    "app/electron/main.mjs",
    "app/electron/preload.cjs",
    "app/dist/assets/app.js",
    "app/electron/bin/ffmpeg",
    "app/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    "LICENSES.chromium.html",
    "MediaSources/source.tar.gz",
    "MediaSources/licenses/notice.txt",
    "MediaLicenses/runtime.json",
  ])
    assert((await fs.stat(path.join(resources, required))).isFile(), required);
});

test("portable Windows package includes and validates the exe media tools", async (t) => {
  const { base, resources } = await fixture(t);
  const called = [];
  await copyResources(base, resources, "win32", (file, args) => {
    called.push(path.basename(file));
    assert.deepEqual(args, ["-buildconf"]);
    return "--disable-gpl";
  });
  assert.deepEqual(called, ["ffmpeg.exe", "ffprobe.exe"]);
  await assert.rejects(
    () => fs.stat(path.join(resources, "app/electron/bin/ffmpeg")),
    { code: "ENOENT" },
  );
});

test("portable package rejects mismatched media source archives", async (t) => {
  const { base, resources, write } = await fixture(t);
  await write("vendor/media/sources/source.tar.gz", "different content");
  await assert.rejects(
    () => copyResources(base, resources, "linux", () => ""),
    /Media source hash mismatch/,
  );
});

test("portable package rejects restricted media configurations", async (t) => {
  const { base, resources } = await fixture(t);
  await assert.rejects(
    () => copyResources(base, resources, "linux", () => "--enable-gpl"),
    /configured LGPL build/,
  );
});
