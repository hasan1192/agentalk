// Convert the ImageGen master PNG into desktop icon sizes and containers.
// Preserve its design and alpha; only resize and encode.
// An isolated temporary profile keeps this independent from user data and keys.
import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(base, "public/brand");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "agentalk-brand-"));
let application;
try {
  const main = path.join(temporary, "render.cjs");
  await fs.writeFile(
    main,
    `
    const { app, BrowserWindow } = require('electron');
    app.setPath('userData', ${JSON.stringify(path.join(temporary, "profile"))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await window.loadURL('data:text/html,<html><body></body></html>');
    });
  `,
  );
  application = await electron.launch({ args: [main], cwd: base });
  const page = await application.firstWindow();
  const source = (
    await fs.readFile(path.join(output, "agentalk-imagegen.png"))
  ).toString("base64");
  const images = new Map();
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const data = await page.evaluate(
      async ({ source, size, inset }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${source}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d");
        const margin = size * inset;
        context.drawImage(
          image,
          margin,
          margin,
          size - margin * 2,
          size - margin * 2,
        );
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { source, size, inset: 0 },
    );
    const png = Buffer.from(data, "base64");
    images.set(size, png);
    await fs.writeFile(path.join(output, `icon-${size}.png`), png);
  }
  // The generated master already has transparent padding for the macOS tile.
  const macImages = images;
  await fs.writeFile(path.join(output, "icon-mac.png"), macImages.get(1024));
  const chunks = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ].map(([type, size]) => {
    const image = macImages.get(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(image.length + 8, 4);
    return Buffer.concat([header, image]);
  });
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write("icns");
  icnsHeader.writeUInt32BE(
    8 + chunks.reduce((size, chunk) => size + chunk.length, 0),
    4,
  );
  await fs.writeFile(
    path.join(output, "agentalk.icns"),
    Buffer.concat([icnsHeader, ...chunks]),
  );

  const sizes = [16, 32, 64, 128, 256];
  const icoHeader = Buffer.alloc(6 + 16 * sizes.length);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(sizes.length, 4);
  let offset = icoHeader.length;
  sizes.forEach((size, index) => {
    const entry = 6 + 16 * index;
    const image = images.get(size);
    icoHeader[entry] = icoHeader[entry + 1] = size === 256 ? 0 : size;
    icoHeader.writeUInt16LE(1, entry + 4);
    icoHeader.writeUInt16LE(32, entry + 6);
    icoHeader.writeUInt32LE(image.length, entry + 8);
    icoHeader.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  await fs.writeFile(
    path.join(output, "agentalk.ico"),
    Buffer.concat([icoHeader, ...sizes.map((size) => images.get(size))]),
  );
  console.log(
    "Agentalk: ImageGen PNG (16–1024), macOS ICNS and Windows ICO ready.",
  );
} finally {
  await application?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
