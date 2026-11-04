import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store, id } from "../electron/store.mjs";
import { Runtime } from "../electron/runtime.mjs";
import { Bridge } from "../electron/bridge.mjs";
import {
  runMedia,
  probeMedia,
  mediaSettings,
  isAnimatedWebP,
} from "../electron/media.mjs";
import { orientedJpeg, rotatedVideo, animatedWebP } from "./fixtures/media.mjs";
import {
  buildContext,
  complete,
  parseReply,
  discoverModels,
} from "../electron/provider.mjs";
import {
  MediaUnsupported,
  mediaPartsFor,
  mediaIndex,
  selectMedia,
  pcmWav,
} from "../electron/media-provider.mjs";
const photo = fs.readFileSync(
  new URL("../public/brand/icon-256.png", import.meta.url),
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(condition) {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await delay(25);
  }
  throw new Error("Media work timed out");
}
function fixture(t, adapter = "compatible") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentalk-media-test-"));
  const store = new Store(root);
  const connection = store.append("connection.created", {
    id: id(),
    name: "Test",
    kind: "local",
    baseUrl: "http://127.0.0.1:1",
    adapter,
    concurrency: 2,
  });
  const a = store.createCharacter({
    name: "Ada",
    connectionId: connection.id,
    model: "test",
    mediaSupport: { image: "yes", audio: "yes", video: "yes" },
  });
  const b = store.createCharacter({
    name: "Bora",
    connectionId: connection.id,
    model: "test",
  });
  const chat = store.createChat({
    name: "Media",
    participantIds: [a.id, b.id],
    heartbeatSeconds: 0,
    respondToPeers: false,
  });
  const vault = { get: () => "", set: () => {}, available: () => true };
  t.after(() => {
    store.media.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, connection, a, b, chat, vault };
}
const stagePhoto = ({ store, chat }, owner = "user") =>
  store.media.stage(chat.id, owner, chat.topicId, "sample.png", photo);
test("animasyonlu WebP özel destek açıklaması verir; statik WebP kabulü korunur", async (t) => {
  const f = fixture(t);
  const animation = fs.readFileSync(await animatedWebP(f.root));
  assert(isAnimatedWebP(animation));
  assert.equal(isAnimatedWebP(animation.subarray(0, 25)), false);
  assert.equal(isAnimatedWebP(Buffer.from("not a WebP")), false);
  for (const owner of ["user", f.a.id]) {
    await assert.rejects(
      f.store.media.stage(
        f.chat.id,
        owner,
        f.chat.topicId,
        "renamed.dat",
        animation,
      ),
      {
        message:
          "Animasyonlu WebP desteklenmiyor. Statik WebP, PNG veya GIF kopyası ekle.",
      },
    );
  }
  assert.equal(f.store.media.drafts.size, 0);
  assert.deepEqual(fs.readdirSync(f.store.media.draftRoot), []);
  const original = await stagePhoto(f);
  const staticImage = await f.store.media.transform(original.id, "user", {
    format: "webp",
  });
  const bytes = fs.readFileSync(
    f.store.media.draftFile(staticImage.id, staticImage.version).file,
  );
  assert.equal(isAnimatedWebP(bytes), false);
  const accepted = await f.store.media.stage(
    f.chat.id,
    "user",
    f.chat.topicId,
    "static.webp",
    bytes,
  );
  assert.equal(accepted.kind, "image");
  assert.equal(accepted.mime, "image/webp");
});
test("boş medya ve belgeler doğru nedenle reddedilir; taslak veya mesaj bırakmaz", async (t) => {
  const f = fixture(t);
  for (const owner of ["user", f.a.id]) {
    for (const name of ["empty.png", "empty.txt", "empty.wav"]) {
      await assert.rejects(
        f.store.media.stage(
          f.chat.id,
          owner,
          f.chat.topicId,
          name,
          Buffer.alloc(0),
        ),
        { message: "Dosya boş. İçerik bulunan bir dosya seç." },
      );
    }
  }
  const outbox = path.join(
    f.store.participantPath(f.chat.id, f.a.id),
    "outbox",
    "media",
  );
  fs.mkdirSync(outbox, { recursive: true });
  fs.writeFileSync(path.join(outbox, "empty.wav"), "");
  await assert.rejects(
    f.store.media.importFolder(f.store, f.chat.id, f.a.id, f.chat.topicId, {
      path: "outbox/media/empty.wav",
    }),
    { message: "Dosya boş. İçerik bulunan bir dosya seç." },
  );
  assert.equal(f.store.media.drafts.size, 0);
  assert.deepEqual(fs.readdirSync(f.store.media.draftRoot), []);
  assert.equal(f.store.state.messages.length, 0);
});
async function tone(root) {
  const file = path.join(root, "tone.wav");
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-y",
    file,
  ]);
  return fs.readFileSync(file);
}
async function clip(root) {
  const file = path.join(root, "clip.webm");
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=8:duration=2",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-pix_fmt",
    "yuv420p",
    "-y",
    file,
  ]);
  return fs.readFileSync(file);
}

test("medya önizlemesi gerçek dosyayı yeniden boyutlandırır, sürümü doğrular ve iptal taslağı temizler", async (t) => {
  const f = fixture(t);
  const first = await stagePhoto(f);
  assert.equal(first.mime, "image/png");
  assert.equal(first.settings.maxSize, 256);
  assert.equal(first.settings.detail, "auto");
  const small = await f.store.media.transform(first.id, "user", {
    maxSize: 128,
    quality: 35,
    format: "webp",
  });
  assert.equal(small.width, 128);
  assert.equal(small.height, 128);
  assert.equal(small.mime, "image/webp");
  assert.notEqual(small.version, first.version);
  assert.throws(
    () =>
      f.store.acceptMessage("user", {
        chatId: f.chat.id,
        attachments: [first],
      }),
    /önizleme/,
  );
  assert.throws(
    () =>
      f.store.acceptMessage(f.a.id, {
        chatId: f.chat.id,
        attachments: [small],
      }),
    /taslağı/,
  );
  const actual = await probeMedia(
    f.store.media.draftFile(small.id, small.version).file,
    small.name,
  );
  assert.equal(actual.width, 128);
  f.store.media.discard(small.id, "user");
  assert.equal(f.store.media.drafts.size, 0);
  assert.throws(
    () => f.store.media.draftFile(small.id, small.version),
    /bulunamadı/,
  );
  assert.throws(() => mediaSettings("video", { fps: 100 }), /sınır/);
  assert.throws(
    () => mediaSettings("audio", { start: 1, duration: 2 }, { duration: 2 }),
    /süresini/,
  );
});

test("ses/video ayarları süre, boyut, FPS ve sıkıştırmayı gerçek dosyada uygular", async (t) => {
  const f = fixture(t);
  const audio = await f.store.media.stage(
    f.chat.id,
    "user",
    f.chat.topicId,
    "tone.wav",
    await tone(f.root),
  );
  assert.equal(audio.mime, "audio/wav");
  assert.equal(audio.settings.sampleRate, 48000);
  assert.equal(audio.settings.channels, 2);
  assert.equal(audio.settings.duration, 2);
  const compressed = await f.store.media.transform(audio.id, "user", {
    start: 0.5,
    duration: 1,
    format: "opus",
    bitrate: 32,
    sampleRate: 16000,
    channels: 1,
  });
  assert.equal(compressed.mime, "audio/ogg");
  assert(compressed.bytes < audio.original.bytes / 8);
  assert(Math.abs(compressed.duration - 1) < 0.1);
  f.store.acceptMessage("user", {
    chatId: f.chat.id,
    to: [f.a.id],
    attachments: [compressed],
  });
  const wire = await mediaPartsFor(
    f.store,
    f.chat.id,
    f.a.id,
    [compressed.id],
    "compatible",
  );
  assert.equal(wire[0].mime, "audio/wav");
  assert.equal(
    Buffer.from(wire[0].data, "base64").toString("ascii", 0, 4),
    "RIFF",
  );
  const video = await f.store.media.stage(
    f.chat.id,
    "user",
    f.chat.topicId,
    "clip.webm",
    await clip(f.root),
  );
  assert.equal(video.settings.fps, 8);
  const compact = await f.store.media.transform(video.id, "user", {
    start: 0,
    duration: 1,
    fps: 2,
    maxSize: 160,
    muted: true,
    quality: 42,
  });
  assert.equal(compact.mime, "video/webm");
  assert.equal(compact.width, 160);
  const details = JSON.parse(
    await runMedia("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      f.store.media.draftFile(compact.id, compact.version).file,
    ]),
  );
  assert.equal(details.streams[0].avg_frame_rate, "2/1");
  assert(!details.streams.some((s) => s.codec_type === "audio"));
});

test("kaynak format, yüzde ölçek ve EXIF/video yönü gerçek çıktıda korunur", async (t) => {
  const f = fixture(t);
  const jpeg = await f.store.media.stage(
    f.chat.id,
    "user",
    f.chat.topicId,
    "portrait.jpg",
    fs.readFileSync(await orientedJpeg(f.root)),
  );
  assert.equal(jpeg.mime, "image/jpeg");
  assert.deepEqual([jpeg.original.width, jpeg.original.height], [90, 160]);
  assert.deepEqual([jpeg.width, jpeg.height], [90, 160]);
  const small = await f.store.media.transform(jpeg.id, "user", {
    resizeMode: "percent",
    scalePercent: 50,
  });
  assert.deepEqual([small.width, small.height], [45, 80]);
  assert.equal(small.settings.scalePercent, 50);
  const reset = await f.store.media.transform(jpeg.id, "user", {});
  assert.deepEqual(reset.settings, jpeg.settings);
  assert.deepEqual([reset.width, reset.height], [90, 160]);
  const webpOutput = await f.store.media.transform(jpeg.id, "user", {
    format: "webp",
  });
  const webp = await f.store.media.stage(
    f.chat.id,
    "user",
    f.chat.topicId,
    "native.webp",
    fs.readFileSync(
      f.store.media.draftFile(webpOutput.id, webpOutput.version).file,
    ),
  );
  assert.equal(webp.mime, "image/webp");
  assert.equal(webp.settings.format, "webp");
  const wav = await f.store.media.stage(
    f.chat.id,
    "user",
    f.chat.topicId,
    "tone.wav",
    await tone(f.root),
  );
  const opus = await f.store.media.transform(wav.id, "user", {
    format: "opus",
    sampleRate: 44100,
  });
  assert.equal(opus.settings.sampleRate, 48000);
  const sourceOpus = await f.store.media.stage(
    f.chat.id,
    "user",
    f.chat.topicId,
    "native.ogg",
    fs.readFileSync(f.store.media.draftFile(opus.id, opus.version).file),
  );
  assert.equal(sourceOpus.settings.format, "opus");
  const longWav = mediaSettings(
    "audio",
    {},
    { format: "wav", duration: 120, sampleRate: 48000, channels: 2 },
  );
  assert.equal(longWav.duration, 120);
  assert.equal(longWav.sampleRate, 24000);
  assert.equal(longWav.format, "wav");
  const video = await f.store.media.stage(
    f.chat.id,
    "user",
    f.chat.topicId,
    "portrait.mp4",
    fs.readFileSync(await rotatedVideo(f.root)),
  );
  assert.deepEqual([video.original.width, video.original.height], [90, 160]);
  assert.deepEqual([video.width, video.height], [90, 160]);
  assert.equal(video.settings.format, "webm");
  assert.equal(video.settings.fps, 8);
  const scaledVideo = await f.store.media.transform(video.id, "user", {
    resizeMode: "percent",
    scalePercent: 50,
  });
  assert.deepEqual([scaledVideo.width, scaledVideo.height], [45, 80]);
  assert.throws(() => mediaSettings("image", { scalePercent: 0 }), /sınır/);
  assert.throws(() => mediaSettings("image", { scalePercent: 101 }), /sınır/);
  assert.throws(() => mediaSettings("image", { maxSize: 0 }), /sınır/);
  assert.equal(
    mediaSettings(
      "image",
      { resizeMode: "percent", scalePercent: 1 },
      { width: 20, height: 10 },
    ).maxSize,
    1,
  );
  assert.equal(
    mediaSettings(
      "image",
      { resizeMode: "percent", scalePercent: 100 },
      { width: 8000, height: 6000 },
    ).maxSize,
    2048,
  );
});

test("yalnız medya mesajı kalıcıdır; günlükte byte/anahtar yoktur ve klasör teslimleri kimliğe göre ayrılır", async (t) => {
  const f = fixture(t);
  const draft = await stagePhoto(f);
  const before = fs.readFileSync(f.store.file, "utf8");
  const m = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    content: "",
    attachments: [draft],
    to: [f.a.id],
    from: f.b.id,
  });
  assert.equal(m.from, "user");
  assert.equal(m.content, "");
  assert.equal(m.attachments.length, 1);
  const inbox = f.store.inbox(f.chat.id, f.a.id)[0].message;
  assert(inbox.attachments[0].path.startsWith("media/"));
  assert(
    fs.existsSync(
      path.join(
        f.store.participantPath(f.chat.id, f.a.id),
        inbox.attachments[0].path,
      ),
    ),
  );
  assert.equal(
    fs.readdirSync(
      path.join(f.store.participantPath(f.chat.id, f.b.id), "media"),
    ).length,
    0,
  );
  assert.equal(f.store.canReadMedia(f.chat.id, f.b.id, draft.id), false);
  assert.equal(f.store.canReadMedia(f.chat.id, f.a.id, draft.id), true);
  assert.throws(
    () =>
      f.store.acceptMessage(f.b.id, {
        chatId: f.chat.id,
        attachments: [{ id: draft.id }],
        to: ["user"],
      }),
    /erişim/,
  );
  const journal = fs.readFileSync(f.store.file, "utf8");
  assert(journal.startsWith(before));
  assert(!journal.includes(photo.toString("base64")));
  assert(!journal.includes("data:image"));
  const restored = new Store(f.root);
  assert.equal(
    restored.state.messages[0].attachments[0].sha256,
    m.attachments[0].sha256,
  );
  assert(restored.media.bytes(f.chat.id, draft.id).length > 0);
  restored.append("chat.updated", { id: f.chat.id, observer: true });
  assert.throws(
    () =>
      restored.acceptMessage("user", {
        chatId: f.chat.id,
        attachments: [{ id: draft.id }],
      }),
    /salt okunur/,
  );
});

test("desteklenmeyen yeni, yanıtlanan, doğal dille istenen ve ajanın kendi eski medyası sohbet açıklaması üretir", async (t) => {
  const f = fixture(t);
  f.store.append("character.updated", {
    id: f.a.id,
    mediaSupport: { image: "no", audio: "no", video: "no" },
  });
  const draft = await stagePhoto(f, f.a.id);
  const own = f.store.acceptMessage(f.a.id, {
    chatId: f.chat.id,
    attachments: [draft],
    content: "Benim görselim",
    to: ["user"],
  });
  let calls = 0;
  const runtime = new Runtime(f.store, f.vault, async () => {
    calls++;
    return { content: "Yanlış" };
  });
  t.after(() => runtime.close());
  for (const data of [
    { content: "Bak", attachments: [await stagePhoto(f)] },
    { content: "Bunu yorumla", replyTo: own.id },
    { content: "Daha önce gönderdiğin fotoğrafa bak" },
  ]) {
    const source = f.store.acceptMessage("user", {
      ...data,
      chatId: f.chat.id,
      to: [f.a.id],
    });
    runtime.tick();
    await wait(
      () =>
        f.store.state.runs.find((r) => r.messageId === source.id)?.status ===
        "done",
    );
    const reply = f.store.state.messages.find((m) => m.replyTo === source.id);
    assert(reply.content.includes("okuyamıyor"));
    assert.equal(reply.from, f.a.id);
    assert(f.chat.waiting);
  }
  assert.equal(calls, 0);
  assert(!f.store.state.runs.some((r) => r.status === "error"));
});

test("geçmiş medya kataloğu private içeriği sızdırmaz ve metin sohbeti gereksiz medya yüklemez", async (t) => {
  const f = fixture(t);
  const draft = await stagePhoto(f);
  const privateM = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    attachments: [draft],
    to: [f.a.id],
  });
  f.store.append("chat.updated", { id: f.chat.id, topicId: id() });
  const plain = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    content: "Merhaba",
    to: [f.a.id],
  });
  const ctx = buildContext(f.store.state, f.chat, f.a, plain);
  assert.deepEqual(ctx.context.mediaIds, []);
  assert(ctx.messages[0].content.includes(draft.id));
  assert(
    !buildContext(f.store.state, f.chat, f.b).messages[0].content.includes(
      draft.id,
    ),
  );
  const reply = { ...plain, replyTo: privateM.id };
  assert.deepEqual(
    selectMedia(
      mediaIndex(f.store.state, f.chat, f.a),
      reply,
      f.store.state,
      f.a,
    ),
    [draft.id],
  );
  await assert.rejects(
    () => mediaPartsFor(f.store, f.chat.id, f.b.id, [draft.id]),
    /erişim/,
  );
});

test("API ajanı doğal geçmiş isteğini medya kimliğiyle çözebilir ve medya ekini geri gönderebilir", async (t) => {
  const f = fixture(t);
  const draft = await stagePhoto(f);
  f.store.acceptMessage("user", {
    chatId: f.chat.id,
    attachments: [draft],
    to: [f.a.id],
  });
  f.store.append("chat.updated", { id: f.chat.id, topicId: id() });
  let calls = 0;
  const runtime = new Runtime(
    f.store,
    f.vault,
    async (_c, _k, _p, messages) => {
      calls++;
      if (calls === 1)
        return {
          content: JSON.stringify({ inspectMedia: [draft.id] }),
          usage: { total_tokens: 3 },
        };
      assert(messages.at(-1).mediaParts[0].data.length > 0);
      return {
        content: JSON.stringify({
          content: "Görüntüyü tekrar paylaşıyorum.",
          to: ["user"],
          attachments: [{ id: draft.id }],
        }),
        usage: { total_tokens: 5 },
      };
    },
  );
  t.after(() => runtime.close());
  const source = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    content: "Paylaştığım terminal simgesini bul ve tekrar yolla",
    to: [f.a.id],
  });
  runtime.tick();
  await wait(() => f.store.state.runs[0]?.status === "done");
  const reply = f.store.state.messages.find((m) => m.replyTo === source.id);
  assert.equal(reply.attachments[0].id, draft.id);
  assert.equal(calls, 2);
  assert.equal(f.store.state.runs[0].usage.total_tokens, 8);
});

test("API modelinin ürettiği fotoğraf, ses ve video gerçek medya mesajlarına dönüşür", async (t) => {
  const f = fixture(t);
  const audio = await tone(f.root),
    video = await clip(f.root);
  let output = photo,
    mime = "image/png";
  const runtime = new Runtime(f.store, f.vault, async () => ({
    content: "",
    mediaOutputs: [
      { mime, data: output.toString("base64"), name: "generated" },
    ],
  }));
  t.after(() => runtime.close());
  for (const [bytes, type, kind] of [
    [photo, "image/png", "image"],
    [audio, "audio/wav", "audio"],
    [video, "video/webm", "video"],
  ]) {
    output = bytes;
    mime = type;
    const source = f.store.acceptMessage("user", {
      chatId: f.chat.id,
      content: `Üret ${kind}`,
      to: [f.a.id],
    });
    runtime.tick();
    await wait(
      () =>
        f.store.state.runs.find((r) => r.messageId === source.id)?.status ===
        "done",
    );
    const reply = f.store.state.messages.find((m) => m.replyTo === source.id);
    assert.equal(reply.attachments[0].kind, kind);
    assert(reply.attachments[0].bytes > 0);
    assert.equal(reply.from, f.a.id);
  }
  assert.equal(f.store.media.drafts.size, 0);
});

test("sağlayıcılar medya parçalarını kendi API şemalarıyla iletir ve native medya çıktılarını alır", async (t) => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    calls.push({ path: req.url, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/messages")
      res.end(JSON.stringify({ content: [{ type: "text", text: "Claude" }] }));
    else if (req.url.includes(":generateContent"))
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Gemini" },
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: photo.toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    else if (req.url === "/api/chat")
      res.end(JSON.stringify({ message: { content: "Ollama" } }));
    else
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Compatible",
                audio: {
                  data: pcmWav(Buffer.alloc(1600).toString("base64")),
                  transcript: "Ses",
                },
              },
            },
          ],
        }),
      );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const part = {
    kind: "image",
    mime: "image/png",
    data: photo.toString("base64"),
    settings: { detail: "low" },
  };
  const character = {
    model: "test",
    mediaSupport: { image: "yes", audio: "yes" },
  };
  for (const adapter of ["compatible", "anthropic", "gemini", "ollama"]) {
    const result = await complete(
      { adapter, baseUrl },
      "test-key",
      character,
      [
        { role: "system", content: "System" },
        { role: "user", content: "Görsel", mediaParts: [part] },
      ],
      new AbortController().signal,
    );
    assert(result.content);
    if (adapter === "gemini")
      assert.equal(result.mediaOutputs[0].mime, "image/png");
    if (adapter === "compatible")
      assert.equal(result.mediaOutputs[0].mime, "audio/wav");
  }
  assert.equal(calls[0].body.messages[1].content[1].image_url.detail, "low");
  assert.equal(calls[1].body.messages[0].content[1].source.type, "base64");
  assert.equal(
    calls[2].body.contents[0].parts[1].inlineData.mimeType,
    "image/png",
  );
  assert.equal(calls[3].body.messages[1].images.length, 1);
  const audio = {
    kind: "audio",
    mime: "audio/wav",
    data: pcmWav(Buffer.alloc(100).toString("base64")),
  };
  await complete(
    { adapter: "compatible", baseUrl },
    "",
    character,
    [{ role: "user", content: "Dinle", mediaParts: [audio] }],
    new AbortController().signal,
  );
  assert.equal(
    calls.at(-1).body.messages[0].content[1].input_audio.format,
    "wav",
  );
  await assert.rejects(
    () =>
      complete(
        { adapter: "anthropic", baseUrl },
        "",
        character,
        [
          {
            role: "user",
            content: "Video",
            mediaParts: [{ ...part, kind: "video", mime: "video/webm" }],
          },
        ],
        new AbortController().signal,
      ),
    MediaUnsupported,
  );
});

test("sağlayıcının medya reddi konuşma yanıtıdır; sunucu gövdesi ve anahtarı günlüğe düşmez", async (t) => {
  const f = fixture(t);
  const draft = await stagePhoto(f);
  const server = http.createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "This model does not support image input. SECRET-BODY-KEY",
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  f.store.append("connection.updated", {
    id: f.connection.id,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  });
  const runtime = new Runtime(f.store, f.vault);
  t.after(() => runtime.close());
  const source = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    attachments: [draft],
    to: [f.a.id],
  });
  runtime.tick();
  await wait(() => f.store.state.runs[0]?.status === "done");
  assert(
    f.store.state.messages
      .find((m) => m.replyTo === source.id)
      .content.includes("okuyamıyor"),
  );
  assert(!fs.readFileSync(f.store.file, "utf8").includes("SECRET-BODY-KEY"));
});

test("folder outbox ve REST medya gönderir; kimlik, erişim, dedup ve dosya kapsamı korunur", async (t) => {
  const f = fixture(t);
  const agent = f.store.createCharacter({ name: "Folder", kind: "folder" });
  f.store.append("chat.updated", {
    id: f.chat.id,
    participantIds: [...f.chat.participantIds, agent.id],
  });
  const memory = new Map(),
    vault = {
      available: () => true,
      get: (key) => memory.get(key) || "",
      set: (key, value) => memory.set(key, value),
    };
  const bridge = new Bridge(f.store, vault, () => {});
  await bridge.start();
  clearInterval(bridge.timer);
  t.after(() => bridge.close());
  const pdir = f.store.participantPath(f.chat.id, agent.id),
    config = JSON.parse(fs.readFileSync(path.join(pdir, "bridge.json")));
  fs.writeFileSync(path.join(pdir, "outbox", "media", "photo.png"), photo);
  const envelope = {
    id: id(),
    token: config.token,
    topicId: f.chat.topicId,
    from: "user",
    content: "Ajan medyası",
    to: ["user"],
    attachments: [
      { path: "outbox/media/photo.png", settings: { maxSize: 128 } },
    ],
  };
  const file = path.join(pdir, "outbox", envelope.id + ".json");
  fs.writeFileSync(file, JSON.stringify(envelope));
  await bridge.pollOutboxes();
  const sent = f.store.state.messages.find((m) => m.id === envelope.id);
  assert.equal(sent.from, agent.id);
  assert.equal(sent.attachments[0].width, 128);
  fs.writeFileSync(file, JSON.stringify(envelope));
  await bridge.pollOutboxes();
  assert.equal(
    f.store.state.messages.filter((m) => m.id === envelope.id).length,
    1,
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...envelope,
      attachments: [
        { path: "outbox/media/photo.png", settings: { maxSize: 256 } },
      ],
    }),
  );
  await bridge.pollOutboxes();
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(pdir, "receipts", envelope.id + ".json")),
    ).status,
    "error",
  );
  const get = (mediaId, token = config.token) =>
    fetch(`${config.endpoint}/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  assert.equal((await get(sent.attachments[0].id)).status, 200);
  assert.equal((await get(sent.attachments[0].id, "bad-token")).status, 400);
  const hidden = await stagePhoto(f);
  f.store.acceptMessage("user", {
    chatId: f.chat.id,
    attachments: [hidden],
    to: [f.a.id],
  });
  assert.equal((await get(hidden.id)).status, 400);
  await assert.rejects(
    () =>
      bridge.prepareMessage(f.chat.id, agent.id, {
        ...envelope,
        id: id(),
        attachments: [{ path: "../../context/messages.json" }],
      }),
    /outbox\/media/,
  );
  fs.symlinkSync(
    path.join(f.root, "_system", "events.jsonl"),
    path.join(pdir, "outbox", "media", "link.wav"),
  );
  await assert.rejects(
    () =>
      bridge.prepareMessage(f.chat.id, agent.id, {
        ...envelope,
        id: id(),
        attachments: [{ path: "outbox/media/link.wav" }],
      }),
    /geçersiz/,
  );
  const response = await fetch(`${config.endpoint}/message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: id(),
      topicId: f.chat.topicId,
      content: "REST medya",
      to: ["user"],
      attachments: [{ name: "rest.png", data: photo.toString("base64") }],
    }),
  });
  assert.equal(response.status, 200);
  for (const [name, bytes, kind] of [
    ["tone.wav", await tone(f.root), "audio"],
    ["clip.webm", await clip(f.root), "video"],
  ]) {
    const messageId = id();
    const response = await fetch(`${config.endpoint}/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: messageId,
        topicId: f.chat.topicId,
        to: ["user"],
        attachments: [{ name, data: bytes.toString("base64") }],
      }),
    });
    assert.equal(response.status, 200);
    const message = f.store.state.messages.find((m) => m.id === messageId);
    assert.equal(message.from, agent.id);
    assert.equal(message.attachments[0].kind, kind);
    assert.equal((await get(message.attachments[0].id)).status, 200);
  }
  assert.equal(f.store.media.drafts.size, 0);
  assert(
    fs
      .readFileSync(path.join(pdir, "BASLA.md"), "utf8")
      .includes(
        "Modeliniz ilgili fotoğraf/ses/video/dosya türünü okuyamıyorsa",
      ),
  );
});

test("medya üretiminde iptal edilen veya eski konu sonucu ek dosya olsa da yayınlanmaz", async (t) => {
  const f = fixture(t);
  let resolve;
  const runtime = new Runtime(
    f.store,
    f.vault,
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  t.after(() => runtime.close());
  f.store.acceptMessage("user", {
    chatId: f.chat.id,
    content: "Görsel üret",
    to: [f.a.id],
  });
  runtime.tick();
  await wait(() => resolve);
  f.store.append("chat.updated", { id: f.chat.id, topicId: id() });
  runtime.cancel(f.chat.id);
  resolve({
    content: "",
    mediaOutputs: [{ mime: "image/png", data: photo.toString("base64") }],
  });
  await wait(() => runtime.active.size === 0);
  assert.equal(f.store.state.messages.length, 1);
  assert.equal(f.store.media.drafts.size, 0);
});

test("medya yanıt şeması modelin keyfi URL veya path üretmesini kabul etmez", () => {
  assert.deepEqual(parseReply('{"inspectMedia":["one"]}', "user"), {
    inspectMedia: ["one"],
  });
  assert.deepEqual(
    parseReply(
      '{"content":"", "to":["user"],"attachments":[{"id":"one"}]}',
      "user",
    ),
    { content: "", to: ["user"], attachments: [{ id: "one" }] },
  );
  assert.throws(
    () =>
      parseReply(
        '{"content":"", "to":["user"],"attachments":[{"path":"/etc/passwd"}]}',
        "user",
      ),
    /geçersiz/,
  );
});

test("kaybolmuş eski medya hata kaydı yerine konuşmada açıklanır", async (t) => {
  const f = fixture(t);
  const draft = await stagePhoto(f);
  const old = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    attachments: [draft],
    to: [f.a.id],
  });
  f.store.append("chat.updated", { id: f.chat.id, topicId: id() });
  fs.unlinkSync(f.store.media.file(f.chat.id, draft.id));
  let calls = 0;
  const runtime = new Runtime(f.store, f.vault, async () => {
    calls++;
    throw new Error("should not call");
  });
  t.after(() => runtime.close());
  const source = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    replyTo: old.id,
    content: "Şu fotoğrafa bak",
    to: [f.a.id],
  });
  runtime.tick();
  await wait(() => f.store.state.runs[0]?.status === "done");
  assert.equal(calls, 0);
  assert(
    f.store.state.messages
      .find((m) => m.replyTo === source.id)
      .content.includes("artık erişemiyorum"),
  );
  assert(f.chat.waiting);
});

test("medya işleminde playlist reddedilir ve reddedilen klasör mesajı taslak bırakmaz", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    () =>
      f.store.media.stage(
        f.chat.id,
        "user",
        f.chat.topicId,
        "list.m3u8",
        Buffer.from(
          "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfile:///etc/hosts\n#EXT-X-ENDLIST\n",
        ),
      ),
    /okunamadı|Desteklenen/,
  );
  assert.equal(f.store.media.drafts.size, 0);
  const agent = f.store.createCharacter({ name: "Folder", kind: "folder" });
  f.store.append("chat.updated", {
    id: f.chat.id,
    participantIds: [...f.chat.participantIds, agent.id],
  });
  const bridge = new Bridge(f.store, f.vault, () => {});
  t.after(() => bridge.close());
  const prepared = await bridge.prepareMessage(f.chat.id, agent.id, {
    id: id(),
    topicId: f.chat.topicId,
    to: ["invalid"],
    attachments: [{ name: "photo.png", data: photo.toString("base64") }],
  });
  assert.equal(f.store.media.drafts.size, 1);
  assert.throws(
    () => bridge.acceptPrepared(agent.id, { ...prepared, chatId: f.chat.id }),
    /alıcı/,
  );
  assert.equal(f.store.media.drafts.size, 0);
});

test("Gemini TTS güncel ve önceki ses protokollerinde yalnızca istenen metni okur", async (t) => {
  const calls = [],
    wav = pcmWav(Buffer.alloc(1600).toString("base64"));
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    calls.push({ route: req.url, body: JSON.parse(raw) });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/interactions"
          ? {
              steps: [
                {
                  type: "model_output",
                  content: [
                    { type: "audio", mime_type: "audio/wav", data: wav },
                  ],
                },
              ],
              usage: { total_tokens: 7 },
            }
          : {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: "audio/L16;rate=24000",
                          data: Buffer.alloc(1600).toString("base64"),
                        },
                      },
                    ],
                  },
                },
              ],
              usageMetadata: { totalTokenCount: 9 },
            },
      ),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const connection = {
    adapter: "gemini",
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
  const messages = [
    { role: "system", content: "JSON and private persona instructions" },
    { role: "user", content: "[User → Ada] Hello", sourceContent: "Hello" },
  ];
  for (const model of [
    "gemini-3.8-flash-tts",
    "gemini-2.5-flash-preview-tts",
  ]) {
    const character = { model, mediaOutput: "audio" };
    const result = await complete(
      connection,
      "",
      character,
      messages,
      new AbortController().signal,
    );
    assert.equal(result.mediaOutputs[0].mime, "audio/wav");
    assert.equal(
      Buffer.from(result.mediaOutputs[0].data, "base64").toString(
        "ascii",
        0,
        4,
      ),
      "RIFF",
    );
    await assert.rejects(
      () =>
        complete(
          connection,
          "",
          { ...character, mediaSupport: { image: "yes" } },
          [{ role: "user", content: "Photo", mediaParts: [{ kind: "image" }] }],
        ),
      MediaUnsupported,
    );
  }
  assert.equal(calls[0].route, "/interactions");
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.input[0].content[0].text, "Hello");
  assert.equal(calls[1].body.contents[0].parts[0].text, "Hello");
  assert(!Object.hasOwn(calls[1].body, "systemInstruction"));
  assert.equal(
    calls[1].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
      .voiceName,
    "Kore",
  );
  assert.equal(calls.length, 2);
});

test("medyalı export görünür kapsamı korur, eski özel byte'ları kaldırır ve hatada önceki export'u korur", async (t) => {
  const { writeChatExport } = await import("../electron/export.mjs");
  const f = fixture(t);
  const publicDraft = await stagePhoto(f);
  const publicMessage = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    attachments: [publicDraft],
    to: [f.a.id],
  });
  const privateDraft = await stagePhoto(f, f.a.id);
  const privateMessage = f.store.acceptMessage(f.a.id, {
    chatId: f.chat.id,
    attachments: [privateDraft],
    to: [f.b.id],
  });
  const destination = path.join(f.root, "export.json");
  const load = () => JSON.parse(fs.readFileSync(destination, "utf8"));
  writeChatExport(f.store, f.chat.id, destination);
  assert(!load().messages.some((m) => m.id === privateMessage.id));
  assert.equal(
    load().messages[0].attachments[0].bytes,
    fs.statSync(path.join(f.root, load().messages[0].attachments[0].exportPath))
      .size,
  );
  f.store.append("chat.updated", { id: f.chat.id, observer: true });
  writeChatExport(f.store, f.chat.id, destination);
  assert(load().messages.some((m) => m.id === privateMessage.id));
  assert(fs.existsSync(path.join(`${destination}.media`, privateDraft.id)));
  f.store.append("chat.updated", { id: f.chat.id, observer: false });
  writeChatExport(f.store, f.chat.id, destination);
  assert(!fs.existsSync(path.join(`${destination}.media`, privateDraft.id)));
  const before = fs.readFileSync(destination, "utf8");
  const oldExportFile = path.join(
    f.root,
    load().messages.find((m) => m.id === publicMessage.id).attachments[0]
      .exportPath,
  );
  const beforeBytes = fs.readFileSync(oldExportFile);
  fs.unlinkSync(f.store.media.file(f.chat.id, publicDraft.id));
  assert.throws(
    () => writeChatExport(f.store, f.chat.id, destination),
    /ENOENT/,
  );
  assert.equal(fs.readFileSync(destination, "utf8"), before);
  assert.deepEqual(fs.readFileSync(oldExportFile), beforeBytes);
  const other = path.join(f.root, "other.json");
  fs.mkdirSync(`${other}.media`);
  fs.writeFileSync(path.join(`${other}.media`, "user-file"), "keep");
  assert.throws(() => writeChatExport(f.store, f.chat.id, other), /zaten var/);
  assert.equal(
    fs.readFileSync(path.join(`${other}.media`, "user-file"), "utf8"),
    "keep",
  );
});

test("medya model keşfi Chat Completions ses modellerini ve Gemini TTS modellerini yanlışlıkla gizlemez", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("api.openai.com")
            ? {
                data: [
                  "gpt-audio-1.5",
                  "gpt-audio-mini",
                  "gpt-4o-audio-preview",
                  "gpt-4o-mini-transcribe",
                  "gpt-image-1",
                  "gpt-realtime",
                  "tts-1",
                  "gpt-test",
                ].map((id) => ({ id })),
              }
            : {
                models: [
                  {
                    name: "models/gemini-3.8-flash-tts",
                    supportedGenerationMethods: ["interactions"],
                  },
                  {
                    name: "models/embedding",
                    supportedGenerationMethods: ["embedContent"],
                  },
                  {
                    name: "models/gemini-test",
                    supportedGenerationMethods: ["generateContent"],
                  },
                ],
              },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  const openai = {
    adapter: "compatible",
    baseUrl: "https://api.openai.com/v1",
  };
  const models = await discoverModels(openai, "");
  assert.deepEqual(models, [
    "gpt-4o-audio-preview",
    "gpt-audio-1.5",
    "gpt-audio-mini",
    "gpt-test",
  ]);
  assert.deepEqual(openai.modelCapabilities["gpt-audio-1.5"], {
    image: false,
    audio: true,
    video: false,
  });
  const gemini = await discoverModels(
    {
      adapter: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    },
    "",
  );
  assert.deepEqual(gemini, ["gemini-3.8-flash-tts", "gemini-test"]);
});

test("taslak düzenlemesi ayrı kaynakla iptal edilir; önceki önizleme ve kimlik korunur", async (t) => {
  const f = fixture(t),
    original = await stagePhoto(f);
  const reduced = await f.store.media.transform(original.id, "user", {
    ...original.settings,
    maxSize: 128,
  });
  const events = fs.readFileSync(
    path.join(f.root, "_system", "events.jsonl"),
    "utf8",
  );
  await assert.rejects(
    () => f.store.media.copyDraft(original.id, f.a.id),
    /bulunamadı/,
  );
  const copy = await f.store.media.copyDraft(original.id, "user");
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.width, 128);
  assert.equal(copy.original.width, 256);
  const expanded = await f.store.media.transform(copy.id, "user", {
    ...copy.settings,
    maxSize: 256,
  });
  assert.equal(expanded.width, 256); // Copy retains the original source, not just its scaled preview.
  f.store.media.discard(copy.id, "user");
  assert.equal(
    f.store.media.drafts.get(original.id).ready.version,
    reduced.version,
  );
  assert(
    fs.existsSync(f.store.media.draftFile(original.id, reduced.version).file),
  );
  assert.equal(
    fs.readFileSync(path.join(f.root, "_system", "events.jsonl"), "utf8"),
    events,
  );
});
