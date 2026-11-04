import fs from "node:fs";
import path from "node:path";
import { runMedia } from "../../electron/media.mjs";

export async function animatedWebP(root) {
  const file = path.join(root, "animated.webp");
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=100x80:rate=2:duration=2",
    "-y",
    file,
  ]);
  return file;
}

export async function orientedJpeg(root, orientation = 6) {
  const file = path.join(root, `orientation-${orientation}.jpg`);
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=1",
    "-frames:v",
    "1",
    "-y",
    file,
  ]);
  const jpeg = fs.readFileSync(file);
  // Minimal EXIF TIFF IFD, containing only the orientation tag.
  const exif = Buffer.from(
    "45786966000049492a0008000000010012010300010000000600000000000000",
    "hex",
  );
  exif.writeUInt16LE(orientation, 24);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1);
  marker.writeUInt16BE(exif.length + 2, 2);
  fs.writeFileSync(
    file,
    Buffer.concat([jpeg.subarray(0, 2), marker, exif, jpeg.subarray(2)]),
  );
  return file;
}

export async function rotatedVideo(root) {
  const source = path.join(root, "landscape.mp4"),
    file = path.join(root, "portrait.mp4");
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=8:duration=1",
    "-c:v",
    "mpeg4",
    "-pix_fmt",
    "yuv420p",
    "-y",
    source,
  ]);
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-display_rotation",
    "90",
    "-i",
    source,
    "-c",
    "copy",
    "-y",
    file,
  ]);
  return file;
}
