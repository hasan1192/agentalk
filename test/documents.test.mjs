import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { Store, id } from "../electron/store.mjs";
import { Bridge } from "../electron/bridge.mjs";
import { Runtime } from "../electron/runtime.mjs";
import { mediaPartsFor, wireMessages } from "../electron/media-provider.mjs";
import {
  buildContext,
  checkMediaSupport,
  parseReply,
} from "../electron/provider.mjs";
import { messagePieces } from "../src/message-layout.mjs";
import { textPdf } from "./fixtures/pdf.mjs";
function fixture(t, folder = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentalk-doc-test-"));
  const store = new Store(root);
  const connection = store.append("connection.created", {
    id: id(),
    adapter: "ollama",
    concurrency: 2,
    baseUrl: "http://127.0.0.1:1",
  });
  const a = store.createCharacter({
    name: "Ada",
    kind: folder ? "folder" : "api",
    connectionId: connection.id,
    model: "test",
    contextBudget: 40000,
  });
  const b = store.createCharacter({
    name: "Bora",
    connectionId: connection.id,
    model: "test",
  });
  const chat = store.createChat({
    name: "Files",
    participantIds: [a.id, b.id],
    heartbeatSeconds: 0,
    respondToPeers: false,
  });
  t.after(() => {
    store.media.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, a, b, chat, connection };
}
const stage = (f, name, data) =>
  f.store.media.stage(f.chat.id, "user", f.chat.topicId, name, data);
const send = (f, a, content = "Before\nAfter", position = 7) =>
  f.store.acceptMessage("user", {
    chatId: f.chat.id,
    content,
    to: [f.a.id],
    attachments: [{ id: a.id, version: a.version, position }],
  });
const wait = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout");
};

test("PDF metni yerelde okunur; konum, izin ve yeniden açılış korunur", async (t) => {
  const f = fixture(t),
    draft = await stage(f, "notes.pdf", textPdf());
  assert.equal(draft.kind, "document");
  assert.equal(draft.document.status, "ready");
  assert.match(draft.document.excerpt, /Agentalk document test/);
  const m = send(f, draft);
  assert.deepEqual(m.attachments[0].placement, {
    offset: 7,
    beforeLine: 1,
    afterLine: 2,
    inline: false,
  });
  assert.equal(f.store.canReadMedia(f.chat.id, f.b.id, draft.id), false);
  const parts = await mediaPartsFor(
    f.store,
    f.chat.id,
    f.a.id,
    [draft.id],
    "ollama",
  );
  await assert.rejects(
    () =>
      checkMediaSupport(
        { adapter: "gemini" },
        "",
        { model: "gemini-tts" },
        parts,
      ),
    /işleyemiyor/,
  );
  assert.deepEqual(
    parseReply(
      JSON.stringify({
        content: "BeforeAfter",
        to: ["user"],
        attachments: [{ id: draft.id, position: 6 }],
      }),
      "user",
    ).attachments,
    [{ id: draft.id, position: 6 }],
  );
  const built = buildContext(f.store.state, f.chat, f.a, m);
  const msg = built.messages.find((msg) => msg.mediaIds?.includes(draft.id));
  msg.mediaParts = parts;
  for (const adapter of ["ollama", "compatible", "anthropic", "gemini"]) {
    const wire = wireMessages([msg], adapter)[0];
    const text =
      adapter === "gemini"
        ? wire.parts.map((p) => p.text).join("")
        : wire.content;
    assert(text.indexOf("Before") < text.indexOf("Agentalk document test"));
    assert(text.indexOf("Agentalk document test") < text.lastIndexOf("After"));
  }
  const copy = new Store(f.root);
  t.after(() => copy.media.close());
  assert.equal(copy.state.messages[0].attachments[0].position, 7);
  assert.equal(
    messagePieces(m.content, m.attachments)[1].attachment.id,
    draft.id,
  );
  assert(
    fs.existsSync(
      path.join(
        copy.participantPath(f.chat.id, f.a.id),
        "media",
        draft.id,
        "document.json",
      ),
    ),
  );
  assert(
    !fs.existsSync(
      path.join(copy.participantPath(f.chat.id, f.b.id), "media", draft.id),
    ),
  );
});

test("Office ve OpenDocument paragrafları, slaytları ve hücreleri okunur", async (t) => {
  const f = fixture(t);
  const cases = [
    [
      "notes.docx",
      {
        "word/document.xml":
          '<w:document xmlns:w="x"><w:p><w:r><w:t>Docx &amp; text</w:t></w:r></w:p></w:document>',
      },
      /Docx & text/,
    ],
    [
      "slides.pptx",
      {
        "ppt/slides/slide2.xml":
          '<a:p xmlns:a="x"><a:r><a:t>Slide two</a:t></a:r></a:p>',
        "ppt/slides/slide1.xml":
          '<a:p xmlns:a="x"><a:r><a:t>Slide one</a:t></a:r></a:p>',
      },
      /Slide one[\s\S]*Slide two/,
    ],
    [
      "sheet.xlsx",
      {
        "xl/sharedStrings.xml": "<sst><si><t>Cell text</t></si></sst>",
        "xl/worksheets/sheet1.xml":
          '<worksheet><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></worksheet>',
      },
      /A1=Cell text\s+B1=42/,
    ],
    [
      "notes.odt",
      {
        "content.xml":
          '<office:text xmlns:office="x" xmlns:text="t"><text:p>Open document</text:p></office:text>',
      },
      /Open document/,
    ],
  ];
  for (const [name, files, expected] of cases) {
    const draft = await stage(
      f,
      name,
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([k, v]) => [k, strToU8(v)]),
        ),
      ),
    );
    assert.equal(draft.document.status, "ready", name);
    assert.match(draft.document.excerpt, expected);
    f.store.media.discard(draft.id, "user");
  }
});

test("bozuk, taranmış, desteklenmeyen ve büyük belgeler sohbet açıklaması üretir ve bekleme sürer", async (t) => {
  for (const [name, bytes, expected] of [
    ["bad.pdf", Buffer.from("%PDF-invalid"), /okuyamıyorum/],
    ["scan.pdf", textPdf(""), /OCR/],
    ["archive.zip", Buffer.from("unknown"), /biçimini/],
    ["large.txt", Buffer.from("x".repeat(200001)), /sınırını/],
  ]) {
    const f = fixture(t),
      draft = await stage(f, name, bytes),
      m = send(f, draft);
    const runtime = new Runtime(f.store, { get: () => "" }, async () => {
      throw new Error("should not call provider");
    });
    t.after(() => runtime.close());
    runtime.tick();
    await wait(() =>
      f.store.state.runs.some(
        (r) => r.messageId === m.id && r.status === "done",
      ),
    );
    assert.match(
      f.store.state.messages.find((x) => x.from === f.a.id).content,
      expected,
    );
    assert.equal(f.chat.waiting, true);
    assert(f.store.state.messages[0].readTimes[f.a.id]);
    runtime.close();
  }
});

test("ek konumu doğrulanır ve tekrar gönderim konumu değiştiremez", async (t) => {
  const f = fixture(t),
    draft = await stage(f, "text.txt", Buffer.from("test"));
  assert.throws(() => send(f, draft, "😀", 1), /konumu/);
  assert.throws(() => send(f, draft, "a", 2), /konumu/);
  const m = send(f, draft, " leading\ntrailing ", 9);
  assert.equal(m.content, " leading\ntrailing ");
  assert.throws(
    () =>
      f.store.acceptMessage("user", {
        ...m,
        attachments: [{ ...m.attachments[0], position: 0 }],
      }),
    /farklı içerik/,
  );
});

test("canlılık dosyası okuma makbuzundan ayrıdır; süre dolumu ve yeniden açılış çevrimdışıdır", async (t) => {
  const f = fixture(t, true),
    tokens = new Map();
  const bridge = new Bridge(
    f.store,
    {
      get: (key) => tokens.get(key),
      set: (key, value) => tokens.set(key, value),
      available: () => true,
    },
    () => {},
  );
  await bridge.start();
  t.after(() => bridge.close());
  const m = f.store.acceptMessage("user", {
    chatId: f.chat.id,
    content: "Unread",
    to: [f.a.id],
  });
  bridge.acquireSession(f.chat.id, f.a.id, "listener");
  const file = path.join(
    f.store.participantPath(f.chat.id, f.a.id),
    "presence.json",
  );
  assert.equal(JSON.parse(fs.readFileSync(file)).online, true);
  assert.equal(m.readTimes[f.a.id], undefined);
  bridge.sessions.get(`${f.chat.id}:${f.a.id}`).expiresAt = Date.now() - 1;
  bridge.sync();
  assert.equal(JSON.parse(fs.readFileSync(file)).online, false);
  const copy = new Store(f.root);
  t.after(() => copy.media.close());
  assert.equal(copy.presence(f.chat.id, f.a.id).online, false);
  assert.equal(
    f.store.events.filter((e) => e.type === "delivery.processed").length,
    0,
  );
  bridge.close();
});
