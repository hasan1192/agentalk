import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { documentFormat, readDocument } from "./documents.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_LIMIT = 12 * 1024 * 1024;
export const UPLOAD_LIMIT = 100 * 1024 * 1024;
const FORMATS =
  "mov,matroska,webm,mp3,wav,ogg,flac,aac,aiff,avi,asf,mpeg,mpegts,image2,png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe,tiff_pipe";
const safe = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
// RIFF/WEBP animation flag, checked before the bundled still-image decoder runs.
// https://developers.google.com/speed/webp/docs/riff_container
export function isAnimatedWebP(bytes) {
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  )
    return false;
  const end = bytes.readUInt32LE(4) + 8;
  if (end > bytes.length || end < 12) return false;
  for (let at = 12; at + 8 <= end;) {
    const length = bytes.readUInt32LE(at + 4),
      next = at + 8 + length + (length % 2);
    if (next > end) return false;
    if (bytes.toString("ascii", at, at + 4) === "VP8X" && length >= 10)
      return Boolean(bytes[at + 8] & 0x02);
    at = next;
  }
  return false;
}
export function mediaBinary(name) {
  const bundled = path.join(
    here,
    "bin",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
  const local = path.join(
    here,
    "..",
    "vendor",
    "media",
    "bin",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
  if (fs.existsSync(bundled)) return bundled;
  if (fs.existsSync(local)) return local;
  throw new Error("Medya araçları kurulmamış. npm run media:setup çalıştır.");
}
export const runMedia = (name, args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      mediaBinary(name),
      args,
      {
        timeout: 180000,
        maxBuffer: 2 * 1024 * 1024,
        signal,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              signal?.aborted
                ? "Medya işlemi iptal edildi."
                : "Medya okunamadı veya dönüştürülemedi. Dosyayı ve seçilen ayarları kontrol et.",
            ),
          );
        else resolve(stdout);
      },
    );
  });
const numeric = (value, fallback, min, max) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new Error("Medya ayarı sınırların dışında.");
  return n;
};
export function mediaSettings(kind, input = {}, source = {}) {
  if (kind === "document") return {};
  const originalSize = Math.max(source.width || 0, source.height || 0);
  const s =
    kind === "audio"
      ? {}
      : {
          resizeMode: input.resizeMode === "percent" ? "percent" : "pixels",
          scalePercent: numeric(input.scalePercent, 100, 1, 100),
          maxSize: Math.round(
            numeric(
              input.maxSize,
              Math.min(originalSize || 1024, 2048),
              1,
              2048,
            ),
          ),
        };
  if (s.resizeMode === "percent")
    s.maxSize = Math.max(
      1,
      Math.min(2048, Math.round((originalSize * s.scalePercent) / 100)),
    );
  if (kind === "image")
    return {
      ...s,
      format: ["jpeg", "webp", "png"].includes(input.format)
        ? input.format
        : source.format || "png",
      quality: Math.round(numeric(input.quality, 78, 20, 100)),
      detail: ["low", "high", "auto"].includes(input.detail)
        ? input.detail
        : "auto",
    };
  const start = numeric(
    input.start,
    0,
    0,
    Math.max(0, (source.duration || 3600) - 0.01),
  );
  const duration = numeric(
    input.duration,
    Math.min((source.duration || 30) - start, 120),
    0.1,
    120,
  );
  if (source.duration && start + duration > source.duration + 0.05)
    throw new Error("Seçilen kesit dosyanın süresini aşıyor.");
  const audio = {
    start,
    duration,
    bitrate: Math.round(numeric(input.bitrate, 64, 32, 192)),
    sampleRate: Math.round(
      numeric(
        input.sampleRate,
        Math.max(8000, Math.min(source.sampleRate || 48000, 48000)),
        8000,
        48000,
      ),
    ),
    channels:
      input.channels === undefined
        ? Math.min(source.channels || 1, 2)
        : input.channels === 2
          ? 2
          : 1,
  };
  if (kind === "audio") {
    const format = ["opus", "wav"].includes(input.format)
      ? input.format
      : source.format || "wav";
    // A full 120-second stereo WAV at 48 kHz exceeds the attachment limit.
    // Keep its format and clip; choose a fitting initial PCM sample rate.
    if (format === "wav" && input.sampleRate === undefined) {
      const budgetRate = (MEDIA_LIMIT * 0.95) / (duration * audio.channels * 2);
      if (audio.sampleRate > budgetRate)
        audio.sampleRate =
          [8000, 12000, 16000, 24000, 44100, 48000]
            .filter((rate) => rate <= budgetRate)
            .at(-1) || 8000;
    }
    return {
      ...audio,
      format,
      sampleRate:
        format === "opus" ? opusRate(audio.sampleRate) : audio.sampleRate,
    };
  }
  return {
    ...s,
    ...audio,
    format: "webm",
    fps: numeric(
      input.fps,
      Math.max(0.5, Math.min(source.fps || 30, 30)),
      0.5,
      30,
    ),
    quality: Math.round(numeric(input.quality, 36, 18, 48)),
    muted: input.muted === true,
    sampleRate: opusRate(audio.sampleRate),
  };
}
const opusRate = (rate) =>
  [8000, 12000, 16000, 24000, 48000].reduce((a, b) =>
    Math.abs(b - rate) < Math.abs(a - rate) ? b : a,
  );
export async function probeMedia(file, name, signal) {
  const raw = JSON.parse(
    await runMedia(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        FORMATS,
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        file,
      ],
      signal,
    ),
  );
  const video = raw.streams?.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const audio = raw.streams?.find((s) => s.codec_type === "audio");
  const duration =
    Number(raw.format?.duration || video?.duration || audio?.duration) || 0;
  const image =
    video &&
    /image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe|gif/.test(
      raw.format?.format_name || "",
    );
  const kind = image ? "image" : video ? "video" : audio ? "audio" : "";
  if (!kind || (kind !== "image" && (!duration || duration > 3600)))
    throw new Error(
      "Desteklenen bir fotoğraf, ses veya video seç (en fazla 1 saat).",
    );
  if (
    video &&
    (video.width > 16000 ||
      video.height > 16000 ||
      video.width * video.height > 80000000)
  )
    throw new Error("Görüntü boyutları çok büyük.");
  // JPEG/TIFF orientation can live on the decoded frame rather than the stream.
  const frame = image
    ? JSON.parse(
        await runMedia(
          "ffprobe",
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            FORMATS,
            "-read_intervals",
            "%+#1",
            "-show_frames",
            "-show_entries",
            "frame_side_data=rotation",
            "-of",
            "json",
            file,
          ],
          signal,
        ),
      ).frames?.[0]
    : undefined;
  const rotation = Number(
    frame?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ||
      video?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ||
      video?.tags?.rotate ||
      0,
  );
  const transpose = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const sar = String(video?.sample_aspect_ratio || "1:1")
    .split(":")
    .map(Number);
  const displayWidth = Math.round(
    (video?.width || 0) * (sar[1] ? sar[0] / sar[1] : 1),
  );
  const rate = String(video?.avg_frame_rate || video?.r_frame_rate || "0/1")
    .split("/")
    .map(Number);
  const format =
    kind === "image"
      ? { mjpeg: "jpeg", webp: "webp", png: "png" }[video.codec_name] || "png"
      : kind === "audio"
        ? /^pcm_|flac|alac/.test(audio.codec_name)
          ? "wav"
          : "opus"
        : "webm";
  return {
    name: path
      .basename(String(name || "media"))
      .replace(/[\x00-\x1f]/g, "")
      .slice(0, 180),
    kind,
    duration,
    width: video ? (transpose ? video.height : displayWidth) : undefined,
    height: video ? (transpose ? displayWidth : video.height) : undefined,
    format,
    sourceFormat: image
      ? video.codec_name === "mjpeg"
        ? "JPEG"
        : video.codec_name.toUpperCase()
      : raw.format?.format_name?.split(",")[0]?.toUpperCase(),
    fps: kind === "video" && rate[1] ? rate[0] / rate[1] : undefined,
    hasAudio: Boolean(audio),
    sampleRate: Number(audio?.sample_rate) || undefined,
    channels: audio?.channels,
    bytes: fs.statSync(file).size,
  };
}
const atomic = (file, value) => {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
};

export class MediaStore {
  constructor(root) {
    this.root = root;
    this.drafts = new Map();
    this.queue = Promise.resolve();
    this.modelConversions = new Map();
    this.draftRoot = path.join(root, "_system", "media-drafts");
    fs.rmSync(this.draftRoot, { recursive: true, force: true });
    fs.mkdirSync(this.draftRoot, { recursive: true, mode: 0o700 });
  }
  assetDir(chatId, id) {
    if (!safe(chatId) || !safe(id)) throw new Error("Geçersiz medya kimliği.");
    return path.join(this.root, "chats", chatId, "_system", "media", id);
  }
  async stage(chatId, owner, topicId, name, bytes, settings) {
    if (!safe(chatId) || !safe(owner))
      throw new Error("Geçersiz medya kimliği.");
    const buffer = Buffer.from(bytes);
    if (!buffer.length)
      throw new Error("Dosya boş. İçerik bulunan bir dosya seç.");
    if (buffer.length > UPLOAD_LIMIT)
      throw new Error("Medya dosyası en fazla 100 MB olmalı.");
    if (isAnimatedWebP(buffer))
      throw new Error(
        "Animasyonlu WebP desteklenmiyor. Statik WebP, PNG veya GIF kopyası ekle.",
      );
    const id = randomUUID(),
      dir = path.join(this.draftRoot, id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const source = path.join(dir, "source");
    fs.writeFileSync(source, buffer, { mode: 0o600 });
    try {
      const cleanName = path
        .basename(String(name || "file"))
        .replace(/[\x00-\x1f]/g, "")
        .slice(0, 180);
      const document = documentFormat(cleanName, buffer);
      const info = document
        ? {
            name: cleanName,
            kind: "document",
            bytes: buffer.length,
            duration: 0,
            ...document,
          }
        : await probeMedia(source, name);
      this.drafts.set(id, {
        id,
        chatId,
        owner,
        topicId,
        dir,
        source,
        info,
        generation: 0,
        controller: null,
      });
      const initial =
        settings ||
        (owner !== "user" && ["audio", "video"].includes(info.kind)
          ? { duration: info.duration }
          : {});
      return await this.transform(id, owner, initial);
    } catch (error) {
      this.discard(id, owner);
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }
  async transform(id, owner, input) {
    const draft = this.drafts.get(id);
    if (!draft || draft.owner !== owner)
      throw new Error("Medya taslağı bulunamadı.");
    const settings = mediaSettings(draft.info.kind, input, draft.info);
    draft.controller?.abort();
    const generation = ++draft.generation;
    const controller = (draft.controller = new AbortController());
    const version = randomUUID();
    const kind = draft.info.kind;
    if (kind === "document") {
      if (draft.info.bytes > MEDIA_LIMIT)
        throw new Error(
          "Dönüştürülen medya 12 MB sınırını aşıyor. Süreyi, boyutu veya kaliteyi azalt.",
        );
      const target = path.join(draft.dir, `${version}.${draft.info.ext}`);
      const document = await readDocument(
        draft.source,
        draft.info.ext,
        controller.signal,
      );
      if (generation !== draft.generation || !this.drafts.has(id))
        throw new Error("Medya işlemi iptal edildi.");
      fs.copyFileSync(draft.source, target);
      draft.ready = {
        id,
        version,
        name: draft.info.name,
        kind,
        mime: draft.info.mime,
        bytes: draft.info.bytes,
        settings,
        sha256: createHash("sha256")
          .update(fs.readFileSync(target))
          .digest("hex"),
        file: path.basename(target),
        document: {
          status: document.status,
          pages: document.pages,
          characters: document.text?.length || 0,
          excerpt:
            document.status === "ready" ? document.text.slice(0, 1500) : "",
        },
      };
      atomic(path.join(draft.dir, "document.json"), document);
      return this.preview(draft);
    }
    const ext =
      kind === "image"
        ? { jpeg: "jpg", webp: "webp", png: "png" }[settings.format]
        : kind === "audio"
          ? settings.format === "opus"
            ? "ogg"
            : "wav"
          : "webm";
    const target = path.join(draft.dir, `${version}.${ext}`);
    const scale = `scale=w='min(${settings.maxSize},iw*sar)':h='min(${settings.maxSize},ih)':force_original_aspect_ratio=decrease:reset_sar=1`;
    const args = [
      "-nostdin",
      "-v",
      "error",
      "-threads",
      "2",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      FORMATS,
      ...(kind === "image" ? [] : ["-ss", String(settings.start)]),
      "-i",
      draft.source,
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
    ];
    if (kind === "image") {
      args.push("-vf", scale, "-frames:v", "1");
      if (settings.format === "jpeg")
        args.push(
          "-q:v",
          String(Math.max(2, Math.round(31 - settings.quality * 0.29))),
        );
      if (settings.format === "webp")
        args.push("-c:v", "libwebp", "-quality", String(settings.quality));
    } else {
      args.push("-t", String(settings.duration));
      if (kind === "audio")
        args.push(
          "-vn",
          "-c:a",
          settings.format === "opus" ? "libopus" : "pcm_s16le",
        );
      else {
        args.push(
          "-vf",
          `${scale},fps=${settings.fps}`,
          "-c:v",
          "libvpx-vp9",
          "-deadline",
          "realtime",
          "-cpu-used",
          "6",
          "-b:v",
          "0",
          "-crf",
          String(settings.quality),
          "-pix_fmt",
          "yuv420p",
        );
        args.push(...(settings.muted ? ["-an"] : ["-c:a", "libopus"]));
      }
      if (!(kind === "video" && settings.muted))
        args.push(
          ...(kind === "audio" && settings.format === "wav"
            ? []
            : ["-b:a", `${settings.bitrate}k`]),
          "-ar",
          String(settings.sampleRate),
          "-ac",
          String(settings.channels),
        );
    }
    args.push("-fs", String(MEDIA_LIMIT + 1024), "-y", target);
    // Serialize encoders to keep UI and model work responsive; cancelled previews leave the queue promptly.
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted)
          throw new Error("Medya işlemi iptal edildi.");
        await runMedia("ffmpeg", args, controller.signal);
        const info = await probeMedia(
          target,
          draft.info.name,
          controller.signal,
        );
        if (info.bytes > MEDIA_LIMIT)
          throw new Error(
            "Dönüştürülen medya 12 MB sınırını aşıyor. Süreyi, boyutu veya kaliteyi azalt.",
          );
        if (kind !== "image" && info.duration + 0.5 < settings.duration)
          throw new Error(
            "Medya boyut sınırına takıldı. Süreyi veya kaliteyi azalt; dosya gönderilmedi.",
          );
        if (generation !== draft.generation || !this.drafts.has(id))
          throw new Error("Medya işlemi iptal edildi.");
        draft.ready = {
          id,
          version,
          name: draft.info.name,
          kind,
          mime:
            kind === "image"
              ? `image/${settings.format}`
              : kind === "audio"
                ? settings.format === "opus"
                  ? "audio/ogg"
                  : "audio/wav"
                : "video/webm",
          bytes: info.bytes,
          width: info.width,
          height: info.height,
          duration: kind === "image" ? undefined : info.duration,
          settings,
          sha256: createHash("sha256")
            .update(fs.readFileSync(target))
            .digest("hex"),
          file: path.basename(target),
        };
        return this.preview(draft);
      });
    this.queue = task;
    return task;
  }
  preview(draft) {
    return {
      ...draft.ready,
      original: draft.info,
      url: `agentalk-media://draft/${draft.id}/${draft.ready.version}`,
    };
  }
  async copyDraft(id, owner) {
    const draft = this.drafts.get(id);
    if (!draft || draft.owner !== owner || !draft.ready)
      throw new Error("Medya taslağı bulunamadı.");
    // Editing is transactional: preserve the source and the old draft for cancel/undo.
    return this.stage(
      draft.chatId,
      owner,
      draft.topicId,
      draft.info.name,
      fs.readFileSync(draft.source),
      draft.ready.settings,
    );
  }
  discard(id, owner) {
    const draft = this.drafts.get(id);
    if (!draft || draft.owner !== owner) return;
    draft.controller?.abort();
    this.drafts.delete(id);
    fs.rmSync(draft.dir, { recursive: true, force: true });
  }
  resolve(chatId, owner, ref, canRead, topicId) {
    if (!ref || !safe(ref.id)) throw new Error("Geçersiz medya eki.");
    const draft = this.drafts.get(ref.id);
    if (draft) {
      if (
        draft.chatId !== chatId ||
        draft.topicId !== topicId ||
        draft.owner !== owner ||
        !draft.ready ||
        ref.version !== draft.ready.version
      )
        throw new Error("Medya taslağı veya önizleme sürümü uyuşmuyor.");
      return { ...draft.ready };
    }
    if (!canRead(ref.id)) throw new Error("Bu medyaya erişim yetkiniz yok.");
    return this.record(chatId, ref.id);
  }
  promote(chatId, owner, ref) {
    const draft = this.drafts.get(ref.id);
    if (!draft) return;
    if (draft.topicId !== ref.topicId)
      throw new Error("Eski konuya ait medya gönderilemez.");
    const dir = this.assetDir(chatId, ref.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(
      path.join(draft.dir, draft.ready.file),
      path.join(dir, draft.ready.file),
    );
    fs.chmodSync(path.join(dir, draft.ready.file), 0o600);
    atomic(path.join(dir, "media.json"), draft.ready);
    if (draft.ready.kind === "document")
      fs.copyFileSync(
        path.join(draft.dir, "document.json"),
        path.join(dir, "document.json"),
      );
    this.discard(ref.id, owner);
  }
  record(chatId, id) {
    const dir = this.assetDir(chatId, id);
    const record = JSON.parse(
      fs.readFileSync(path.join(dir, "media.json"), "utf8"),
    );
    if (
      !safe(record.version) ||
      !/^[a-zA-Z0-9_-]+\.(jpg|webp|png|mp3|webm|wav|mp4|ogg|pdf|docx|pptx|xlsx|odt|ods|odp|txt|md|csv|tsv|json|xml|log|bin)$/.test(
        record.file,
      )
    )
      throw new Error("Medya kaydı geçersiz.");
    return record;
  }
  file(chatId, id) {
    const record = this.record(chatId, id);
    return path.join(this.assetDir(chatId, id), record.file);
  }
  bytes(chatId, id) {
    return fs.readFileSync(this.file(chatId, id));
  }
  async modelBytes(chatId, id, adapter, signal) {
    const record = this.record(chatId, id);
    if (record.kind === "document") {
      // Recheck the original so missing files follow the normal missing-media path.
      this.bytes(chatId, id);
      const document = JSON.parse(
        fs.readFileSync(
          path.join(this.assetDir(chatId, id), "document.json"),
          "utf8",
        ),
      );
      return {
        mime: record.mime,
        bytes: Buffer.from(document.text || ""),
        document,
      };
    }
    if (
      record.kind === "audio" &&
      adapter === "compatible" &&
      !["audio/wav", "audio/mpeg"].includes(record.mime)
    ) {
      const target = path.join(this.assetDir(chatId, id), "model.wav");
      if (!fs.existsSync(target)) {
        if (!this.modelConversions.has(target)) {
          const tmp = path.join(
            this.assetDir(chatId, id),
            `model-${randomUUID()}.wav`,
          );
          const job = runMedia("ffmpeg", [
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            this.file(chatId, id),
            "-vn",
            "-c:a",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-y",
            tmp,
          ])
            .then(() => fs.renameSync(tmp, target))
            .finally(() => this.modelConversions.delete(target));
          this.modelConversions.set(target, job);
        }
        await this.modelConversions.get(target);
      }
      if (signal?.aborted) throw new Error("Medya işlemi iptal edildi.");
      return { mime: "audio/wav", bytes: fs.readFileSync(target) };
    }
    return { mime: record.mime, bytes: this.bytes(chatId, id) };
  }
  draftFile(id, version) {
    const draft = this.drafts.get(id);
    if (!draft || draft.owner !== "user" || draft.ready?.version !== version)
      throw new Error("Önizleme bulunamadı.");
    return {
      file: path.join(draft.dir, draft.ready.file),
      mime: draft.ready.mime,
    };
  }
  folderFile(store, chatId, owner, ref) {
    if (typeof ref.path !== "string" || path.isAbsolute(ref.path))
      throw new Error("Medya yolu outbox/media içinde göreli olmalı.");
    const base = path.join(
      store.participantPath(chatId, owner),
      "outbox",
      "media",
    );
    const file = path.resolve(store.participantPath(chatId, owner), ref.path);
    if (!file.startsWith(base + path.sep))
      throw new Error("Medya yolu outbox/media içinde olmalı.");
    const real = fs.realpathSync(file);
    if (
      real !== path.join(fs.realpathSync(base), path.relative(base, file)) ||
      fs.lstatSync(base).isSymbolicLink() ||
      !fs.lstatSync(file).isFile() ||
      fs.statSync(file).size > UPLOAD_LIMIT
    )
      throw new Error("Medya dosyası veya yolu geçersiz.");
    return file;
  }
  async importFolder(store, chatId, owner, topicId, ref) {
    if (ref.id) return ref;
    const file = this.folderFile(store, chatId, owner, ref);
    const draft = await this.stage(
      chatId,
      owner,
      topicId,
      path.basename(file),
      fs.readFileSync(file),
      ref.settings,
    );
    return draft;
  }
  close() {
    for (const draft of this.drafts.values()) draft.controller?.abort();
  }
}
