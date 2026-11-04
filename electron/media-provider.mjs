import { translate } from "../src/locale.mjs";
import en from "../src/locales/en.json" with { type: "json" };
import de from "../src/locales/de.json" with { type: "json" };

export class MediaUnsupported extends Error {
  constructor(kinds, reason = "unsupported") {
    super("Model bu medya türünü işleyemiyor.");
    this.kinds = [...new Set(kinds)];
    this.reason = reason;
  }
}
export function mediaExplanation(state, kinds, reason = "unsupported") {
  const tr = (key, vars) =>
    translate({ en, de }, state.language || "tr", key, vars);
  if (reason === "limit")
    return tr(
      "İstenen medya bu çağrının boyut veya inceleme sınırını aşıyor. Daha az dosya veya daha kısa bir kesit seçebilir misin?",
    );
  if (
    kinds.includes("document") &&
    ["password", "no-text", "unreadable", "unsupported-document"].includes(
      reason,
    )
  ) {
    return tr(
      {
        password:
          "Bu dosya şifreli olduğu için içeriğini okuyamıyorum. Şifresiz bir kopya paylaşabilir misin?",
        "no-text":
          "Bu dosyada okunabilir metin bulunamadı; taranmış sayfalar için OCR henüz yok. Metin içeren bir kopya veya transkript paylaşabilir misin?",
        unreadable:
          "Bu dosyanın içeriğini okuyamıyorum. Dosya bozulmuş olabilir; başka bir kopya veya içeriğini metin olarak paylaşabilir misin?",
        "unsupported-document":
          "Bu dosya biçimini okuyamıyorum. PDF, DOCX, XLSX, PPTX, OpenDocument veya metin dosyası olarak paylaşabilir misin?",
      }[reason],
    );
  }
  const types = kinds
    .map((kind) =>
      tr(
        { image: "fotoğraf", audio: "ses", video: "video", document: "dosya" }[
          kind
        ] || "medya",
      ),
    )
    .join(", ");
  return tr(
    reason === "output"
      ? "Bu model {types} içeriği üretemiyor. Medya çıkışını destekleyen bir model seçebilir veya metin yanıtıyla devam edebilirsin."
      : reason === "missing"
        ? "Bu {types} içeriğinin dosyasına artık erişemiyorum. Yeniden ekleyebilir veya içeriğini metin olarak paylaşabilirsin."
        : "Bu model {types} içeriğini okuyamıyor; medyayı incelemiş gibi yanıt veremem. İçeriğini metin olarak açıklayabilir, ses için transkript paylaşabilir veya ilgili medya türünü destekleyen bir model seçebilirsin.",
    { types },
  );
}
export function mediaIndex(state, chat, character) {
  return state.messages
    .filter(
      (m) =>
        m.chatId === chat.id &&
        !m.deleted &&
        (m.from === character.id || m.recipients.includes(character.id)),
    )
    .flatMap((m) =>
      (m.attachments || []).map((a) => ({
        ...a,
        messageId: m.id,
        from: m.from,
        time: m.time,
        topicId: m.topicId,
      })),
    );
}
export function selectMedia(index, source, state, character) {
  const selected = new Set((source?.attachments || []).map((a) => a.id));
  const reply =
    source?.replyTo &&
    state.messages.find(
      (m) =>
        m.id === source.replyTo &&
        !m.deleted &&
        (m.from === character.id || m.recipients.includes(character.id)),
    );
  for (const a of reply?.attachments || []) selected.add(a.id);
  const content = String(source?.content || "").toLocaleLowerCase();
  for (const a of index)
    if (
      content.includes(a.id.toLowerCase()) ||
      content.includes(a.name.toLocaleLowerCase())
    )
      selected.add(a.id);
  const refers =
    /(önceki|önceden|daha önce|yukarıdaki|son |eski|az önce|previous|earlier|last |above|vorher|früher|letzte)/i.test(
      content,
    );
  if (refers) {
    for (const [kind, words] of Object.entries({
      image: /fotoğraf|fotograf|resim|görsel|photo|image|picture|bild|foto/i,
      audio: /ses|kayıt|kayit|audio|recording|aufnahme/i,
      video: /video|klip|clip/i,
      document:
        /pdf|belge|döküman|doküman|document|spreadsheet|tablo|sunum|dosya|file|datei|dokument/i,
    })) {
      if (words.test(content)) {
        const last = index.filter((a) => a.kind === kind).at(-1);
        if (last) selected.add(last.id);
      }
    }
    if (/medya|media|dosya|file|datei/i.test(content)) {
      const last = index.at(-1);
      if (last) selected.add(last.id);
    }
  }
  return [...selected].filter((id) => index.some((a) => a.id === id));
}
const capabilityCache = new Map();
export async function assertMediaSupported(
  connection,
  key,
  character,
  parts,
  signal,
  request,
) {
  const kinds = [
    ...new Set(
      parts.filter((part) => part.kind !== "document").map((part) => part.kind),
    ),
  ];
  if (
    connection.adapter === "gemini" &&
    /(?:^|-)tts(?:-|$)/i.test(character.model || "") &&
    parts.length
  )
    throw new MediaUnsupported(parts.map((part) => part.kind));
  let discovered = connection.modelCapabilities?.[character.model];
  if (
    connection.adapter === "ollama" &&
    kinds.some(
      (kind) => !["yes", "no"].includes(character.mediaSupport?.[kind]),
    ) &&
    !discovered
  ) {
    const cacheKey = `${connection.id || connection.baseUrl}:${character.model}`;
    const cached = capabilityCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) discovered = cached.value;
    else {
      try {
        const data = await request(connection, "/api/show", key, {
          method: "POST",
          signal,
          body: JSON.stringify({ model: character.model }),
        });
        if (Array.isArray(data.capabilities))
          discovered = {
            image: data.capabilities.includes("vision"),
            audio: data.capabilities.includes("audio"),
            video: data.capabilities.includes("video"),
          };
        capabilityCache.set(cacheKey, {
          expires: Date.now() + 60000,
          value: discovered,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
  }
  const wire = {
    compatible: ["image", "audio"],
    anthropic: ["image"],
    gemini: ["image", "audio", "video"],
    ollama: ["image"],
  }[connection.adapter] || ["image"];
  const unsupported = kinds.filter((kind) => {
    if (!wire.includes(kind) || character.mediaSupport?.[kind] === "no")
      return true;
    if (character.mediaSupport?.[kind] === "yes") return false;
    if (discovered?.[kind] !== undefined) return !discovered[kind];
    if (connection.adapter === "ollama") return true;
    if (connection.adapter === "compatible" && kind === "audio") return true;
    return false;
  });
  if (unsupported.length) throw new MediaUnsupported(unsupported);
}
export function wireMessages(messages, adapter) {
  return messages.map((message) => {
    const parts = message.mediaParts || [];
    const role = parts.length ? "user" : message.role;
    if (!parts.length) return { role, content: message.content };
    const used = new Set();
    const ordered = [];
    for (const piece of message.orderedContent || [
      { text: message.content || "[Dosya]" },
    ]) {
      if (piece.text) ordered.push({ text: piece.text });
      if (piece.mediaId) {
        const part = parts.find((p) => p.id === piece.mediaId);
        if (part) {
          ordered.push({ part });
          used.add(part.id);
        }
      }
    }
    for (const part of parts) if (!used.has(part.id)) ordered.push({ part });
    const textOf = (piece) =>
      piece.text ??
      (piece.part?.kind === "document"
        ? `\n[${piece.part.name} — dosya metni]\n${piece.part.text}\n[Dosya metni sonu]\n`
        : null);
    const text = ordered.map((p) => textOf(p) || "").join("");
    if (adapter === "ollama")
      return {
        role,
        content: text,
        ...(parts.some((p) => p.kind === "image")
          ? {
              images: parts
                .filter((p) => p.kind === "image")
                .map((p) => p.data),
            }
          : {}),
      };
    if (adapter === "gemini")
      return {
        role,
        content: text,
        parts: ordered.map((p) =>
          textOf(p) !== null
            ? { text: textOf(p) }
            : {
                inlineData: { mimeType: p.part.mime, data: p.part.data },
                ...(p.part.kind === "video"
                  ? { videoMetadata: { fps: p.part.settings?.fps || 1 } }
                  : {}),
              },
        ),
      };
    if (parts.every((p) => p.kind === "document"))
      return { role, content: text };
    return {
      role,
      content: ordered.map((p) => {
        const text = textOf(p);
        if (text !== null) return { type: "text", text };
        const part = p.part;
        if (adapter === "anthropic")
          return {
            type: "image",
            source: { type: "base64", media_type: part.mime, data: part.data },
          };
        return part.kind === "image"
          ? {
              type: "image_url",
              image_url: {
                url: `data:${part.mime};base64,${part.data}`,
                detail: part.settings?.detail || "low",
              },
            }
          : {
              type: "input_audio",
              input_audio: {
                data: part.data,
                format: part.mime === "audio/wav" ? "wav" : "mp3",
              },
            };
      }),
    };
  });
}
export async function mediaPartsFor(
  store,
  chatId,
  characterId,
  ids,
  adapter,
  signal,
) {
  const unique = [...new Set(ids)];
  if (unique.length > 6)
    throw new MediaUnsupported(["image", "audio", "video"], "limit");
  const parts = await Promise.all(
    unique.map(async (id) => {
      if (!store.canReadMedia(chatId, characterId, id))
        throw new Error("Bu medyaya erişim yetkiniz yok.");
      const a = store.state.messages
        .flatMap((m) => m.attachments || [])
        .find((a) => a.id === id);
      try {
        const model = await store.media.modelBytes(chatId, id, adapter, signal);
        if (model.document && model.document.status !== "ready")
          throw new MediaUnsupported(
            ["document"],
            model.document.status === "unsupported"
              ? "unsupported-document"
              : model.document.status,
          );
        return {
          ...a,
          mime: model.mime,
          data: model.bytes.toString("base64"),
          bytes: model.bytes.length,
          ...(model.document ? { text: model.document.text } : {}),
        };
      } catch (error) {
        if (error instanceof MediaUnsupported) throw error;
        throw new MediaUnsupported([a?.kind || "image"], "missing");
      }
    }),
  );
  if (parts.reduce((sum, a) => sum + a.bytes, 0) > 16 * 1024 * 1024)
    throw new MediaUnsupported(
      parts.map((p) => p.kind),
      "limit",
    );
  return parts;
}
export function decodeDataUrl(value) {
  if (typeof value !== "string" || value.length > 17 * 1024 * 1024)
    throw new Error("Modelin medya verisi çok büyük.");
  const match = value.match(
    /^data:((?:image|audio|video)\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match)
    throw new Error(
      "Modelin medya yanıtı gömülü veri olmalı; uzak adresler otomatik indirilmez.",
    );
  return { mime: match[1], data: match[2], name: "model-media" };
}
export function pcmWav(base64, rate = 24000) {
  const pcm = Buffer.from(base64, "base64");
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString("base64");
}
