import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJSON } from "./store.mjs";

export function writeChatExport(store, chatId, destination) {
  const chat = store.chat(chatId);
  const mediaDir = `${destination}.media`;
  const marker = ".agentalk-export.json";
  const filename = path.basename(destination);
  if (fs.existsSync(mediaDir)) {
    let managed;
    try {
      managed = JSON.parse(
        fs.readFileSync(path.join(mediaDir, marker), "utf8"),
      );
    } catch {}
    if (managed?.schemaVersion !== 1 || managed.exportFile !== filename)
      throw new Error(
        "Bu dışa aktarımın medya klasörü zaten var. Başka bir dosya adı seç.",
      );
  }
  const temp = fs.mkdtempSync(
    path.join(path.dirname(destination), ".agentalk-export-"),
  );
  const staged = path.join(temp, "media");
  const backup = path.join(temp, "previous-media");
  let swapped = false,
    saved = false;
  try {
    fs.mkdirSync(staged, { mode: 0o700 });
    atomicJSON(path.join(staged, marker), {
      schemaVersion: 1,
      exportFile: filename,
    });
    const messages = store.state.messages.filter(
      (m) =>
        m.chatId === chatId &&
        (chat.observer || m.from === "user" || m.recipients.includes("user")),
    );
    const exported = messages.map((message) => {
      if (message.deleted || !message.attachments?.length)
        return { ...message, attachments: undefined };
      return {
        ...message,
        attachments: message.attachments.map((a) => {
          const dir = path.join(staged, a.id);
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
          fs.copyFileSync(
            store.media.file(chatId, a.id),
            path.join(dir, a.file),
          );
          fs.chmodSync(path.join(dir, a.file), 0o600);
          return {
            ...a,
            exportPath: `${path.basename(mediaDir)}/${a.id}/${a.file}`,
          };
        }),
      };
    });
    const jsonFile = path.join(temp, `${randomUUID()}.json`);
    atomicJSON(jsonFile, {
      schemaVersion: 2,
      chat,
      messages: exported,
      exportedAt: new Date().toISOString(),
      scope: chat.observer ? "owner-observer" : "user-visible",
    });
    if (fs.existsSync(mediaDir)) fs.renameSync(mediaDir, backup);
    try {
      fs.renameSync(staged, mediaDir);
    } catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, mediaDir);
      throw error;
    }
    swapped = true;
    fs.renameSync(jsonFile, destination);
    saved = true;
  } finally {
    if (swapped && !saved) {
      fs.rmSync(mediaDir, { recursive: true, force: true });
      if (fs.existsSync(backup)) fs.renameSync(backup, mediaDir);
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
