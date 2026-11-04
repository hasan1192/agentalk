import { Worker } from "node:worker_threads";
import path from "node:path";

export const DOCUMENT_TEXT_LIMIT = 200000;
const formats = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  xml: "application/xml",
  log: "text/plain",
};
const mediaExtensions = new Set(
  "png jpg jpeg webp gif bmp tiff tif heic avif mov mp4 m4v mkv webm avi mpeg mpg mp3 wav ogg opus flac aac m4a aiff aif m3u m3u8 pls".split(
    " ",
  ),
);
export function documentFormat(name, bytes) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (bytes.subarray(0, 5).toString() === "%PDF-")
    return { ext: "pdf", mime: formats.pdf };
  if (
    /^(89504e47|ffd8ff|47494638|52494646|4f676753|664c6143|494433|1a45dfa3)/.test(
      bytes.subarray(0, 4).toString("hex"),
    ) ||
    bytes.subarray(4, 8).toString() === "ftyp"
  )
    return null;
  if (mediaExtensions.has(ext)) return null;
  return {
    ext: formats[ext] ? ext : "bin",
    mime: formats[ext] || "application/octet-stream",
  };
}
export function readDocument(file, format, signal) {
  if (format === "bin")
    return Promise.resolve({ status: "unsupported", text: "" });
  return new Promise((resolve) => {
    const worker = new Worker(
      new URL("./document-worker.mjs", import.meta.url),
      {
        workerData: { file, format, limit: DOCUMENT_TEXT_LIMIT },
        resourceLimits: { maxOldGenerationSizeMb: 192 },
      },
    );
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      resolve(result);
    };
    const abort = () => finish({ status: "unreadable", text: "" });
    const timer = setTimeout(
      () => finish({ status: "limit", text: "" }),
      20000,
    );
    worker.once("message", finish);
    worker.once("error", () => finish({ status: "unreadable", text: "" }));
    worker.once("exit", () => finish({ status: "unreadable", text: "" }));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
