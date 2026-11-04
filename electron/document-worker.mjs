import fs from "node:fs";
import { workerData, parentPort } from "node:worker_threads";
import { unzipSync } from "fflate";
import { SaxesParser } from "saxes";

const { file, format, limit } = workerData;
const buffer = fs.readFileSync(file);
class Limit extends Error {}
const check = (text) => {
  if (text.length > limit) throw new Limit();
  return text;
};
function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error("binary");
  return text;
}
function xml(bytes, kind, strings = []) {
  const parser = new SaxesParser({ xmlns: false });
  const stack = [];
  let out = "",
    cell = null,
    shared = "";
  const add = (text) => {
    out = check(out + text);
  };
  parser.on("doctype", () => {
    throw new Error("doctype");
  });
  parser.on("opentag", (tag) => {
    const name = tag.name.split(":").at(-1);
    stack.push(name);
    if (kind === "xlsx" && name === "c")
      cell = { type: tag.attributes.t, ref: tag.attributes.r, value: "" };
    if (kind === "strings" && name === "si") shared = "";
    if (["br", "line-break"].includes(name)) add("\n");
    if (name === "tab") add("\t");
    if (kind === "open" && name === "table")
      add(`\n[${tag.attributes["table:name"] || "Table"}]\n`);
  });
  parser.on("text", (text) => {
    const name = stack.at(-1);
    if (kind === "strings" && name === "t") shared = check(shared + text);
    else if (kind === "xlsx" && cell && ["v", "t"].includes(name))
      cell.value = check(cell.value + text);
    else if (kind === "office" && name === "t") add(text);
    else if (kind === "open" && stack.some((n) => ["p", "h"].includes(n)))
      add(text);
  });
  parser.on("closetag", (tag) => {
    const name = tag.name.split(":").at(-1);
    if (kind === "strings" && name === "si") strings.push(shared);
    if (kind === "xlsx" && name === "c" && cell) {
      add(
        `${cell.ref || ""}=${cell.type === "s" ? (strings[Number(cell.value)] ?? "") : cell.value}\t`,
      );
      cell = null;
    }
    if (["p", "h", "row", "tr", "table-row"].includes(name)) add("\n");
    if (["tc", "table-cell"].includes(name)) add("\t");
    stack.pop();
  });
  parser.on("error", (error) => {
    throw error;
  });
  parser.write(decode(bytes)).close();
  return out;
}
async function extract() {
  if (format === "pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 300) throw new Limit();
      let text = "",
        emptyPages = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const { items } = await page.getTextContent();
        const body = items
          .map((i) =>
            i.str === undefined ? "" : i.str + (i.hasEOL ? "\n" : " "),
          )
          .join("")
          .trim();
        if (!body) emptyPages++;
        text = check(
          text +
            `[Page ${n}]\n${body || "[No readable text on this page; OCR is unavailable.]"}\n\n`,
        );
        page.cleanup();
      }
      // No OCR: do not pass an empty or partial scan off as fully read.
      return {
        status: emptyPages === pdf.numPages ? "no-text" : "ready",
        text: emptyPages === pdf.numPages ? "" : text,
        pages: pdf.numPages,
      };
    } finally {
      await task.destroy();
    }
  }
  if (["docx", "pptx", "xlsx", "odt", "ods", "odp"].includes(format)) {
    let total = 0,
      count = 0;
    const wanted =
      format === "docx"
        ? /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/
        : format === "pptx"
          ? /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/
          : format === "xlsx"
            ? /^xl\/(worksheets\/sheet\d+|sharedStrings|workbook)\.xml$/
            : /^content\.xml$/;
    const files = unzipSync(new Uint8Array(buffer), {
      filter(entry) {
        if (++count > 4000) throw new Limit();
        if (!wanted.test(entry.name)) return false;
        total += entry.originalSize;
        if (total > 12 * 1024 * 1024 || entry.originalSize > 4 * 1024 * 1024)
          throw new Limit();
        return true;
      },
    });
    const names = Object.keys(files)
      .filter((n) => !/sharedStrings|workbook/.test(n))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    if (!names.length) throw new Error("empty archive");
    const strings = [];
    if (files["xl/sharedStrings.xml"])
      xml(files["xl/sharedStrings.xml"], "strings", strings);
    let text = "";
    for (const name of names)
      text = check(
        text +
          `[${name}]\n` +
          xml(
            files[name],
            format === "xlsx"
              ? "xlsx"
              : format.startsWith("od")
                ? "open"
                : "office",
            strings,
          ) +
          "\n",
      );
    return {
      status: text.replace(/\[[^\]]*\]/g, "").trim() ? "ready" : "no-text",
      text,
    };
  }
  const text = check(decode(buffer));
  return { status: text.trim() ? "ready" : "no-text", text };
}
try {
  parentPort.postMessage(await extract());
} catch (error) {
  parentPort.postMessage({
    status:
      error instanceof Limit
        ? "limit"
        : error.name === "PasswordException"
          ? "password"
          : "unreadable",
    text: "",
  });
}
