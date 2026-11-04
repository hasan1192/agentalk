import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFile(path.join(base, relative), "utf8");
const notices = JSON.parse(await read("src/legal-notices.json"));
const packageInfo = JSON.parse(await read("package.json"));
const mediaManifest = JSON.parse(await read("docs/media-runtime.json"));
const document = await read("THIRD_PARTY_NOTICES.md");
const covered = new Set(notices.flatMap((notice) => notice.packages || []));
const normalize = (text) => text.trim().replace(/\s+/g, " ");
assert.equal(
  createHash("sha256")
    .update(await read("docs/licenses/saxes-LICENSE.txt"))
    .digest("hex"),
  "0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e",
  "saxes upstream license changed",
);

for (const notice of notices) {
  assert(notice.name && notice.license && notice.source && notice.text);
  assert(
    document.includes(notice.text.trim()),
    `${notice.name}: document drift`,
  );
  for (const file of notice.files || []) {
    assert(
      notice.text.includes((await read(file)).trim()),
      `${notice.name}: missing notice from ${file}`,
    );
  }
  if (notice.source.startsWith("node_modules/") && !notice.files) {
    assert.equal(
      normalize(notice.text),
      normalize(await read(notice.source)),
      `${notice.name}: installed license changed`,
    );
  }
}

assert.equal(
  await read("docs/licenses/Vite-runtime-LICENSE.txt"),
  (await read("node_modules/vite/LICENSE.md"))
    .split("# Licenses of bundled dependencies")[0]
    .trim() + "\n",
  "Vite runtime license changed",
);
assert.equal(
  await read("docs/licenses/Rolldown-runtime-LICENSE.txt"),
  (await read("node_modules/rolldown/LICENSE")) +
    "\n\n" +
    (await read("node_modules/rolldown/THIRD-PARTY-LICENSE")) +
    "\n",
  "Rolldown runtime licenses changed",
);

for (const dependency of Object.keys(packageInfo.dependencies)) {
  assert(covered.has(dependency), `Missing runtime license: ${dependency}`);
}
// These main-process parsers ship with the local app as well as the renderer.
for (const dependency of ["pdfjs-dist", "fflate", "saxes", "xmlchars"]) {
  assert(
    covered.has(dependency),
    `Missing document parser license: ${dependency}`,
  );
  const installed = JSON.parse(
    await read(`node_modules/${dependency}/package.json`),
  );
  assert(
    notices.some(
      (notice) =>
        notice.packages?.includes(dependency) &&
        notice.name.endsWith(installed.version),
    ),
    `Document parser version changed: ${dependency}`,
  );
}
for (const source of mediaManifest.sources) {
  assert(
    notices.some((notice) => notice.source === source.url),
    `Media source version has no matching notice: ${source.file}`,
  );
}
// Source maps reveal dependency code actually shipped in the renderer.
// Generated Vite/Rolldown helpers are covered explicitly above.
for (const file of await fs.readdir(path.join(base, "dist/assets"))) {
  if (!file.endsWith(".js.map")) continue;
  const map = JSON.parse(await read(`dist/assets/${file}`));
  for (const source of map.sources) {
    if (!source.includes("node_modules/")) continue;
    const parts = source.split("node_modules/").at(-1).split("/");
    const dependency = parts[0].startsWith("@")
      ? parts.slice(0, 2).join("/")
      : parts[0];
    assert(
      covered.has(dependency),
      `Unlisted bundled dependency: ${dependency}`,
    );
  }
}
for (const file of ["LICENSE", "LICENSES.chromium.html"]) {
  assert((await read(`node_modules/electron/dist/${file}`)).length > 100);
}
console.log(`License inventory verified: ${notices.length} entries.`);
