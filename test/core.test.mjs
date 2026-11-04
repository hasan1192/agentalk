import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store, visibleTo, id } from "../electron/store.mjs";
import { Runtime } from "../electron/runtime.mjs";
import { Bridge } from "../electron/bridge.mjs";
import {
  buildContext,
  validateConnection,
  discoverModels,
  complete,
  parseReply,
} from "../electron/provider.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (condition) => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await delay(15);
  }
  throw new Error("Koşul zamanında gerçekleşmedi.");
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentalk-core-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  const connection = store.append("connection.created", {
    id: id(),
    name: "Local",
    baseUrl: "http://127.0.0.1:11434",
    kind: "local",
    adapter: "ollama",
    concurrency: 1,
    models: [],
    hasKey: false,
  });
  const a = store.createCharacter({
    name: "Ada",
    model: "local-model",
    connectionId: connection.id,
  });
  const b = store.createCharacter({
    name: "Bora",
    model: "local-model",
    connectionId: connection.id,
  });
  const chat = store.createChat({
    name: "Test masası",
    participantIds: [a.id, b.id],
    heartbeatSeconds: 0,
  });
  const memory = new Map();
  const vault = {
    get: (k) => memory.get(k) || "",
    set: (k, v) => memory.set(k, v),
    available: () => true,
  };
  return { root, store, connection, chat, a, b, vault };
}

test("dış ajan yokken köprü başlangıcı ve taraması anahtar kasasını sorgulamaz", async (t) => {
  const { store } = fixture(t);
  const unexpected = () => {
    assert.fail("API kişileri için köprü kasa sorgusu yapmamalı.");
  };
  const bridge = new Bridge(
    store,
    { available: unexpected, get: unexpected, set: unexpected },
    () => {},
  );
  t.after(() => bridge.close());
  await bridge.start();
  bridge.sync();
  bridge.pollOutboxes();
  assert(bridge.port > 0);
  assert.equal(bridge.busy, false);
});

test("hedefli mesaj, kimlik doğrulaması ve tekilleştirme", (t) => {
  const { store, chat, a, b } = fixture(t);
  const data = {
    id: id(),
    chatId: chat.id,
    content: "Yalnızca Ada görsün.",
    to: [a.id],
  };
  const first = store.acceptMessage("user", data);
  assert.deepEqual(first.recipients, [a.id]);
  assert.equal(store.inbox(chat.id, a.id).length, 1);
  assert.equal(store.inbox(chat.id, b.id).length, 0);
  assert.equal(store.acceptMessage("user", data).id, first.id);
  assert.equal(store.state.messages.length, 1);
  assert.throws(
    () => store.acceptMessage("user", { ...data, content: "Değiştirildi" }),
    /farklı içerik/,
  );
  assert.throws(() => store.acceptMessage("sahte-kimlik", data), /bağlı değil/);
  assert.throws(
    () =>
      store.acceptMessage(b.id, {
        chatId: chat.id,
        content: "Görmediğim mesaja cevap",
        replyTo: first.id,
      }),
    /izinli/,
  );
});
test("AI özel mesajı başka karakterin veya kullanıcının bağlamına girmez", (t) => {
  const { store, chat, a, b } = fixture(t);
  const privateMessage = store.acceptMessage(a.id, {
    chatId: chat.id,
    content: "Bora için özel.",
    to: [b.id],
  });
  assert.equal(visibleTo(privateMessage, "user"), false);
  const onlyA = store.acceptMessage("user", {
    chatId: chat.id,
    content: "Ada için özel.",
    to: [a.id],
  });
  const aContext = buildContext(store.state, chat, a).context.messageIds;
  const bContext = buildContext(store.state, chat, b).context.messageIds;
  assert(aContext.includes(onlyA.id));
  assert(!bContext.includes(onlyA.id));
  assert(bContext.includes(privateMessage.id));
  const eventCount = store.events.length;
  store.append("chat.updated", { id: chat.id, observer: true });
  assert.throws(
    () =>
      store.acceptMessage("user", {
        chatId: chat.id,
        content: "Gözlemden yaz",
      }),
    /salt okunur/,
  );
  assert.equal(store.events.length, eventCount + 1);
  assert.equal(store.inbox(chat.id, "user").length, 0);
});
test("alıcı teslim sırası merkezi sıra boşluklarına rağmen atlanamaz", (t) => {
  const { store, chat, a, b } = fixture(t);
  store.acceptMessage("user", { chatId: chat.id, content: "Bir", to: [a.id] });
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Başka alıcı",
    to: [b.id],
  });
  store.acceptMessage("user", { chatId: chat.id, content: "İki", to: [a.id] });
  assert.throws(() => store.receipt(chat.id, a.id, 2), /atlanamaz/);
  store.receipt(chat.id, a.id, 1);
  store.receipt(chat.id, a.id, 2);
  assert.deepEqual(
    store.inbox(chat.id, a.id).map((x) => x.deliverySequence),
    [1, 2],
  );
});
test("yeniden açılış kayıtları ve eksik kutu teslimlerini kurtarır", (t) => {
  const { store, root, chat, a } = fixture(t);
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Kalıcı mesaj",
    to: [a.id],
  });
  const inboxDir = path.join(store.participantPath(chat.id, a.id), "inbox");
  fs.rmSync(inboxDir, { recursive: true });
  const restored = new Store(root);
  assert.equal(restored.state.messages.length, 1);
  assert.equal(restored.chat(chat.id).waiting, true);
  assert.equal(fs.readdirSync(inboxDir).length, 1);
  const before = fs.readFileSync(store.file, "utf8");
  restored.acceptMessage(a.id, {
    chatId: chat.id,
    content: "Yanıt",
    to: ["user"],
  });
  assert(fs.readFileSync(store.file, "utf8").startsWith(before));
});
test("yarım veya sırası bozuk geçmiş sessizce geçilmez", (t) => {
  const { store, root } = fixture(t);
  fs.appendFileSync(store.file, '{"yarım":');
  assert.throws(() => new Store(root), /yarım/);
});
test("bekleme devam eder, tek bağlantı kapasitesi aşılmaz", async (t) => {
  const { store, chat, a, b, vault } = fixture(t);
  let active = 0,
    maximum = 0,
    calls = 0;
  const runtime = new Runtime(store, vault, async () => {
    active++;
    maximum = Math.max(maximum, active);
    calls++;
    await delay(20);
    active--;
    return {
      content: '{"content":"Somut katkı","to":["user"]}',
      usage: { total_tokens: 12 },
    };
  });
  t.after(() => runtime.close());
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "İlk soru",
    to: ["all"],
  });
  runtime.tick();
  await waitFor(
    () => store.state.runs.filter((r) => r.status === "done").length === 1,
  );
  runtime.tick();
  await waitFor(
    () => store.state.runs.filter((r) => r.status === "done").length === 2,
  );
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "İkinci soru",
    to: [a.id],
  });
  runtime.tick();
  await waitFor(
    () => store.state.runs.filter((r) => r.status === "done").length === 3,
  );
  assert.equal(maximum, 1);
  assert.equal(calls, 3);
  assert.equal(store.state.messages.filter((m) => m.from === b.id).length, 1);
  assert.equal(chat.waiting, true);
});
test("eski konuya geç yanıt, sağlayıcı iptali yok saysa bile yayınlanmaz", async (t) => {
  const { store, chat, a, vault } = fixture(t);
  let resolve;
  const runtime = new Runtime(
    store,
    vault,
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  t.after(() => runtime.close());
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Eski soru",
    to: [a.id],
  });
  runtime.tick();
  store.append("chat.updated", { id: chat.id, topicId: id() });
  runtime.cancel(chat.id);
  resolve({ content: "Çok geç yanıt", usage: {} });
  await waitFor(() => runtime.active.size === 0);
  assert.equal(store.state.messages.length, 1);
  assert.equal(store.state.runs[0].status, "cancelled");
});
test("bağlam bütçesi aşılırsa kırpmadan ve çağrı yapmadan görünür hata verir", async (t) => {
  const { store, chat, a, vault } = fixture(t);
  store.append("character.updated", { id: a.id, contextBudget: 10 });
  let calls = 0;
  const runtime = new Runtime(store, vault, async () => {
    calls++;
    return { content: "olmamalı" };
  });
  t.after(() => runtime.close());
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Uzun sayılabilecek soru",
    to: [a.id],
  });
  runtime.tick();
  await waitFor(() => store.state.runs[0]?.status === "error");
  assert.equal(calls, 0);
  assert.match(store.state.runs[0].error, /kırpılmadı/);
  assert(store.state.runs[0].context.characters > 10);
});
test("yerel/uzak adres doğrulama ve yapılandırılmış yanıt kontrolü", () => {
  assert.throws(
    () =>
      validateConnection({
        name: "Sahte yerel",
        baseUrl: "http://192.168.1.10",
        kind: "local",
      }),
    /loopback/,
  );
  assert.throws(
    () =>
      validateConnection({
        name: "Bulut",
        baseUrl: "http://api.example.org",
        kind: "cloud",
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateConnection({
        name: "Gizli",
        baseUrl: "https://user:key@example.org",
        kind: "cloud",
      }),
    /anahtarsız/,
  );
  assert.equal(parseReply("[BEKLE]", "user"), null);
  assert.deepEqual(parseReply("Düz yanıt", "user"), {
    content: "Düz yanıt",
    to: ["user"],
  });
  assert.throws(
    () => parseReply('{"content":"yanıt","to":"user"}', "user"),
    /geçersiz/,
  );
});
test("anahtarsız native ve uyumlu endpointler gerçek HTTP çağrısıyla çalışır", async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      path: req.url,
      auth: req.headers.authorization,
      body: body ? JSON.parse(body) : null,
    });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/api/tags"
          ? { models: [{ name: "local" }] }
          : req.url === "/v1/models"
            ? { data: [{ id: "compatible" }] }
            : req.url === "/api/chat"
              ? {
                  message: { content: "Native yanıt" },
                  prompt_eval_count: 3,
                  eval_count: 2,
                }
              : {
                  choices: [{ message: { content: "Uyumlu yanıt" } }],
                  usage: { total_tokens: 5 },
                },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const native = { baseUrl, adapter: "ollama" };
  const compatible = { baseUrl: `${baseUrl}/v1`, adapter: "compatible" };
  assert.deepEqual(await discoverModels(native, ""), ["local"]);
  assert.deepEqual(await discoverModels(compatible, ""), ["compatible"]);
  assert.equal(
    (
      await complete(
        native,
        "",
        { model: "local" },
        [{ role: "user", content: "Merhaba" }],
        new AbortController().signal,
      )
    ).content,
    "Native yanıt",
  );
  assert.equal(
    (
      await complete(
        compatible,
        "",
        { model: "compatible" },
        [{ role: "user", content: "Merhaba" }],
        new AbortController().signal,
      )
    ).content,
    "Uyumlu yanıt",
  );
  assert(requests.every((r) => !r.auth));
  assert.equal(requests[3].body.model, "compatible");
});
test("Anthropic, Gemini ve OpenRouter sağlayıcı protokolleri ve başlıkları doğru çalışır", async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      path: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/anthropic/messages") {
      res.end(
        JSON.stringify({
          id: "msg_123",
          content: [{ type: "text", text: "Claude yanıtı" }],
          usage: { input_tokens: 15, output_tokens: 25 },
        }),
      );
    } else if (req.url === "/models/gemini-2.0-flash:generateContent") {
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "Gemini yanıtı" }] },
            },
          ],
          usageMetadata: { totalTokenCount: 30 },
        }),
      );
    } else if (req.url === "/openrouter.ai/chat/completions") {
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "OpenRouter yanıtı" } }],
          usage: { total_tokens: 40 },
        }),
      );
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Anthropic test
  const anthropicConn = {
    baseUrl: `${baseUrl}/anthropic`,
    adapter: "anthropic",
  };
  const claudeRes = await complete(
    anthropicConn,
    "sk-ant-test-key",
    { model: "claude-3-5-sonnet-20241022" },
    [
      { role: "system", content: "Sen yardımcısın." },
      { role: "user", content: "Selam" },
    ],
    new AbortController().signal,
  );
  assert.equal(claudeRes.content, "Claude yanıtı");
  assert.equal(claudeRes.usage.total_tokens, 40);
  const anthropicReq = requests.find((r) => r.path === "/anthropic/messages");
  assert.equal(anthropicReq.headers["x-api-key"], "sk-ant-test-key");
  assert.equal(anthropicReq.headers["anthropic-version"], "2023-06-01");
  assert.equal(anthropicReq.body.system, "Sen yardımcısın.");
  assert.equal(anthropicReq.body.messages[0].role, "user");
  assert.equal(anthropicReq.body.messages[0].content, "Selam");

  // 2. Gemini test
  const geminiConn = { baseUrl, adapter: "gemini" };
  const geminiRes = await complete(
    geminiConn,
    "AIzaSy-test-key",
    { model: "gemini-2.0-flash" },
    [
      { role: "system", content: "Sen yardımcısın." },
      { role: "user", content: "Selam" },
    ],
    new AbortController().signal,
  );
  assert.equal(geminiRes.content, "Gemini yanıtı");
  assert.equal(geminiRes.usage.total_tokens, 30);
  const geminiReq = requests.find(
    (r) => r.path === "/models/gemini-2.0-flash:generateContent",
  );
  assert.equal(geminiReq.headers["x-goog-api-key"], "AIzaSy-test-key");
  assert.equal(
    geminiReq.body.systemInstruction.parts[0].text,
    "Sen yardımcısın.",
  );
  assert.equal(geminiReq.body.contents[0].role, "user");

  // 3. OpenRouter test
  const openRouterConn = {
    baseUrl: `${baseUrl}/openrouter.ai`,
    adapter: "compatible",
  };
  const orRes = await complete(
    openRouterConn,
    "sk-or-test-key",
    { model: "openai/gpt-4o" },
    [{ role: "user", content: "Selam" }],
    new AbortController().signal,
  );
  assert.equal(orRes.content, "OpenRouter yanıtı");
  const orReq = requests.find((r) =>
    r.path.startsWith("/openrouter.ai/chat/completions"),
  );
  assert.equal(orReq.headers["authorization"], "Bearer sk-or-test-key");
  assert.equal(orReq.headers["http-referer"], "https://agentalk.app");
  assert.equal(orReq.headers["x-title"], "Agentalk");
});
test("yerel köprü kimliğin kapsamını doğrular ve eski konu mesajını reddeder", async (t) => {
  const { store, chat, vault } = fixture(t);
  const c = store.createCharacter({
    kind: "folder",
    name: "Dış ajan",
    chatId: chat.id,
  });
  const d = store.createCharacter({
    kind: "folder",
    name: "Başka ajan",
    chatId: chat.id,
  });
  const bridge = new Bridge(store, vault, () => {});
  await bridge.start();
  t.after(() => bridge.close());
  const endpoint = `http://127.0.0.1:${bridge.port}/v1/${chat.id}/${c.id}`;
  const token = bridge.credential(chat.id, c.id);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  assert.equal((await fetch(`${endpoint}/inbox`, { headers })).status, 200);
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${bridge.port}/v1/${chat.id}/${d.id}/inbox`,
        { headers },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${endpoint}/inbox`, {
        headers: { ...headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const message = {
    id: id(),
    from: d.id,
    topicId: chat.topicId,
    content: "Gerçek gönderici köprüden gelir.",
    to: ["user"],
  };
  const result = await fetch(`${endpoint}/message`, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  assert.equal(result.status, 200);
  assert.equal(store.state.messages.at(-1).from, c.id);
  store.append("chat.updated", { id: chat.id, topicId: id() });
  assert.equal(
    (
      await fetch(`${endpoint}/message`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...message, id: id() }),
      })
    ).status,
    400,
  );
});

test("dış ajan klasöründe BASLA.md üretilir, cursor açıklaması ve kurallar uygundur", (t) => {
  const { store, chat } = fixture(t);
  const agent = store.createCharacter({
    kind: "folder",
    name: "Özel Dış Ajan",
    chatId: chat.id,
  });
  const pdir = store.participantPath(chat.id, agent.id);
  const baslaFile = path.join(pdir, "BASLA.md");
  assert(fs.existsSync(baslaFile), "BASLA.md dosyası oluşturulmalı.");
  const baslaContent = fs.readFileSync(baslaFile, "utf8");
  assert(baslaContent.includes("Özel Dış Ajan"));
  assert(baslaContent.includes("inbox"));
  assert(baslaContent.includes("outbox"));
  assert(baslaContent.includes("receipts"));
  assert(baslaContent.includes("quarantine"));
  assert(baslaContent.includes('status === "accepted"'));
  // Gözlem modu ifşası kaldırılmış olmalı
  assert(!baslaContent.includes("Oturum sahibi gözlem modunda"));
  assert(
    !fs
      .readFileSync(path.join(pdir, "rules", "rules.md"), "utf8")
      .includes("gözlem modunda"),
  );

  const cursor = JSON.parse(
    fs.readFileSync(path.join(pdir, "receipts", "cursor.json"), "utf8"),
  );
  assert.equal(cursor.deliverySequence, 0);
  assert.match(cursor.description, /Yeni mesaj sayısı DEĞİLDİR/);
});

test("hatalı veya tokensiz outbox zarfı karantinaya alınır, outboxta kalıp tekrar taranmaz ve hata makbuzu üretir", async (t) => {
  const { store, chat, vault } = fixture(t);
  const agent = store.createCharacter({
    kind: "folder",
    name: "Hata Test Ajanı",
    chatId: chat.id,
  });
  const bridge = new Bridge(store, vault, () => {});
  await bridge.start();
  t.after(() => bridge.close());

  const pdir = store.participantPath(chat.id, agent.id);
  const badEnvelopePath = path.join(pdir, "outbox", "bad-message.json");
  // Token içermeyen veya geçersiz token zarfı
  fs.writeFileSync(
    badEnvelopePath,
    JSON.stringify({
      id: id(),
      topicId: chat.topicId,
      content: "Geçersiz tokenli mesaj",
      to: ["user"],
    }),
  );

  bridge.pollOutboxes();

  // Outbox'ta kalmamalı!
  assert(
    !fs.existsSync(badEnvelopePath),
    "Hatalı dosya outbox'tan kaldırılmalıdır.",
  );

  // Quarantine klasörüne taşınmış olmalı
  const quarantineFiles = fs.readdirSync(path.join(pdir, "quarantine"));
  assert(
    quarantineFiles.length >= 1,
    "Hatalı dosya quarantine klasörüne taşınmalıdır.",
  );

  // Hata makbuzu üretilmiş olmalı
  const receiptFile = path.join(pdir, "receipts", "bad-message.json");
  assert(fs.existsSync(receiptFile), "Hata makbuzu üretilmelidir.");
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  assert.equal(receipt.status, "error");
  assert(receipt.quarantined);

  // Tekrar tarandığında yeni hata oluşturmamalı / döngüye girmemeli
  bridge.pollOutboxes();
  assert.equal(fs.readdirSync(path.join(pdir, "outbox")).filter((name) => name.endsWith(".json")).length, 0);
});

test("outbox ack dosyası teslimat sırasını onaylar ve cursoru ilerletir", async (t) => {
  const { store, chat, vault } = fixture(t);
  const agent = store.createCharacter({
    kind: "folder",
    name: "Ack Ajanı",
    chatId: chat.id,
  });
  const bridge = new Bridge(store, vault, () => {});
  await bridge.start();
  t.after(() => bridge.close());

  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Ack için teslimat",
    to: [agent.id],
  });

  const pdir = store.participantPath(chat.id, agent.id);
  const token = bridge.credential(chat.id, agent.id);
  const ackFile = path.join(pdir, "outbox", "ack-1.json");
  fs.writeFileSync(
    ackFile,
    JSON.stringify({
      token,
      deliverySequence: 1,
    }),
  );

  bridge.pollOutboxes();

  assert(!fs.existsSync(ackFile), "Ack dosyası outbox'tan silinmeli.");
  const receipt = JSON.parse(
    fs.readFileSync(path.join(pdir, "receipts", "ack-1.json"), "utf8"),
  );
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.deliverySequence, 1);
});

test("mesaj silme kontrol olayı üretir, bağlamdan temizlenir ve aktif çalışmayı iptal eder", async (t) => {
  const { store, chat, a, vault } = fixture(t);
  let resolve;
  const runtime = new Runtime(
    store,
    vault,
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  t.after(() => runtime.close());

  const msg = store.acceptMessage("user", {
    chatId: chat.id,
    content: "Silinecek soru",
    to: [a.id],
  });

  runtime.tick();
  assert.equal(runtime.active.size, 1);

  // Mesaj silinir
  const deleted = store.deleteMessage(chat.id, msg.id, "user");
  assert(deleted);
  assert.equal(deleted.content, "Bu mesaj silindi.");

  // Silinmiş mesaja yanıt verme girişimi reddedilmeli
  assert.throws(
    () =>
      store.acceptMessage("user", {
        chatId: chat.id,
        content: "Silinmişe cevap",
        replyTo: msg.id,
      }),
    /Silinmiş/,
  );

  // Bağlamdan silinen mesaj çıkarılmalı
  const ctx = buildContext(store.state, chat, a);
  assert(!ctx.context.messageIds.includes(msg.id));

  // Runtime tick silinen mesajın aktif run'ını abort etmeli
  runtime.tick();
  resolve?.({ content: "Geciken cevap" });
  await waitFor(() => runtime.active.size === 0);
  assert.equal(store.state.runs[0].status, "cancelled");
  assert.equal(store.state.messages.length, 1);
});

test("alıntılı yanıtta yetkisiz veya silinmiş içerik gizlenir", (t) => {
  const { store, chat, a, b } = fixture(t);
  const secretMsg = store.acceptMessage(a.id, {
    chatId: chat.id,
    content: "Ada'nın gizli mesajı",
    to: ["user"],
  });

  // User gizli mesajı alıntılayarak Bora'ya yanıt verir
  const quoteMsg = store.acceptMessage("user", {
    chatId: chat.id,
    content: "Bora'ya alıntılı mesaj",
    to: [b.id],
    replyTo: secretMsg.id,
  });

  // Bora bu gizli mesajı görmeye yetkili olmadığı için bağlamında [Özel mesaj içeriği] olarak görünmeli
  const bCtx = buildContext(store.state, chat, b);
  const quoteLine = bCtx.messages.find((m) => m.content.includes("Alıntı"));
  assert(quoteLine);
  assert(quoteLine.content.includes("[Özel mesaj içeriği]"));
  assert(!quoteLine.content.includes("Ada'nın gizli mesajı"));
});

test("yalnızca doğrudan hitap edilince cevap verme", async (t) => {
  const { store, chat, a, b, vault } = fixture(t);
  const runtime = new Runtime(store, vault, async () => ({
    content: '{"content":"Cevap","to":["all"]}',
  }));
  t.after(() => runtime.close());

  // mention_only modu
  store.append("chat.updated", { id: chat.id, mode: "mention_only" });
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Herkes için genel soru",
    to: ["all"],
  });
  runtime.tick();
  // mention_only modunda genel "all" mesajı hiçbir AI'yi kuyruğa almamalı
  assert.equal(store.state.runs.length, 0);

  // Açıkça Ada hedeflenince sadece Ada kuyruğa alınmalı
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Sadece Ada cevaplasın",
    to: [a.id],
  });
  runtime.tick();
  assert.equal(store.state.runs.length, 1);
  assert.equal(store.state.runs[0].characterId, a.id);
});

test("tur bütçesi dolunca konuşma duraklatılır ve yeni iş kuyruğa alınmaz", async (t) => {
  const { store, chat, a, vault } = fixture(t);
  store.append("chat.updated", { id: chat.id, maxTurns: 1 });
  const runtime = new Runtime(store, vault, async () => ({
    content: '{"content":"Bütçeyi tüketen yanıt","to":["user"]}',
  }));
  t.after(() => runtime.close());

  store.acceptMessage("user", {
    chatId: chat.id,
    content: "İlk soru",
    to: [a.id],
  });
  runtime.tick();
  await waitFor(
    () => store.state.runs.filter((r) => r.status === "done").length === 1,
  );

  // Chat bütçe dolduğu için duraklatılmış olmalı
  assert.equal(chat.waiting, false);
  assert.equal(chat.turnCount, 1);

  // Yeni mesaj gelse bile otomatik yanıt üretilmemeli
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "İkinci soru ama duraklatıldı",
    to: [a.id],
  });
  runtime.tick();
  assert.equal(store.state.runs.length, 1);
});

test("çift aktif oturum lease kontrolü ile engellenir", async (t) => {
  const { store, chat, vault } = fixture(t);
  const agent = store.createCharacter({
    kind: "folder",
    name: "Lease Ajanı",
    chatId: chat.id,
  });
  const bridge = new Bridge(store, vault, () => {});
  await bridge.start();
  t.after(() => bridge.close());

  bridge.acquireSession(chat.id, agent.id, "session-1");
  // Aynı oturum yenileyebilir
  assert.doesNotThrow(() =>
    bridge.acquireSession(chat.id, agent.id, "session-1"),
  );
  // Farklı oturum 409 hatası almalı
  assert.throws(
    () => bridge.acquireSession(chat.id, agent.id, "session-2"),
    /başka bir aktif dinleyici/,
  );
});

test("okundu makbuzu katılımcı bazlı kaydedilir", (t) => {
  const { store, chat, a } = fixture(t);
  const msg = store.acceptMessage("user", {
    chatId: chat.id,
    content: "Okunacak mesaj",
    to: [a.id],
  });
  assert(msg.readTimes["user"]);
  assert(!msg.readTimes[a.id]);

  store.markRead(chat.id, a.id, msg.id);
  const updated = store.state.messages.find((m) => m.id === msg.id);
  assert(updated.readTimes[a.id]);
});

test("farklı karakterler aynı bağlantıyı bağımsız bağlam ve farklı modellerle kullanabilir", async (t) => {
  const { store, vault } = fixture(t);
  const conn = store.append("connection.created", {
    id: id(),
    name: "Shared-Cloud-API",
    baseUrl: "https://api.openai.com/v1",
    kind: "cloud",
    adapter: "compatible",
    concurrency: 2,
    models: ["gpt-4o", "o3-mini"],
    hasKey: true,
  });

  const c1 = store.createCharacter({
    name: "Filozof",
    role: "Derin düşünür",
    instructions: "Felsefi perspektif sun.",
    model: "gpt-4o",
    connectionId: conn.id,
  });

  const c2 = store.createCharacter({
    name: "Mühendis",
    role: "Pratik yapıcı",
    instructions: "Somut teknik çözümler üret.",
    model: "o3-mini",
    connectionId: conn.id,
  });

  const sharedChat = store.createChat({
    name: "Çoklu Karakter Masası",
    rules: "Kurallar",
    participantIds: [c1.id, c2.id],
    heartbeatSeconds: 0,
  });

  const recordedCalls = [];
  const runtime = new Runtime(
    store,
    vault,
    async (connection, key, character, messages) => {
      recordedCalls.push({
        connectionId: connection.id,
        characterId: character.id,
        characterName: character.name,
        model: character.model,
        instructions: character.instructions,
        messagesCount: messages.length,
      });
      return {
        content: JSON.stringify({
          content: `${character.name} yanıtı (${character.model})`,
          to: ["user"],
        }),
        usage: { total_tokens: 25 },
      };
    },
  );
  t.after(() => runtime.close());

  // 1. Genel mesaj: Her iki karakter de aynı bağlantıyı farklı modellerle çağırır
  store.acceptMessage("user", {
    chatId: sharedChat.id,
    content: "Yapay zeka geleceği hakkında ne düşünüyorsunuz?",
    to: ["all"],
  });
  runtime.tick();

  await waitFor(() => recordedCalls.length === 2);

  // Çağrılan modellerin ve karakterlerin doğrulanması
  const call1 = recordedCalls.find((c) => c.characterId === c1.id);
  const call2 = recordedCalls.find((c) => c.characterId === c2.id);

  assert(call1, "Filozof çağrılmış olmalı");
  assert.equal(call1.connectionId, conn.id);
  assert.equal(call1.model, "gpt-4o");
  assert.equal(call1.characterName, "Filozof");

  assert(call2, "Mühendis çağrılmış olmalı");
  assert.equal(call2.connectionId, conn.id);
  assert.equal(call2.model, "o3-mini");
  assert.equal(call2.characterName, "Mühendis");

  // Yanıtların kabul edilmesi
  await waitFor(
    () =>
      store.state.messages.some((m) => m.from === c1.id) &&
      store.state.messages.some((m) => m.from === c2.id),
  );

  // 2. Karakter güncellemesi: Bir karakterin model/bağlantı/bütçe güncellemesi diğerini etkilemez
  store.append("character.updated", {
    id: c1.id,
    model: "chatgpt-4o-latest",
    contextBudget: 80000,
  });
  const updatedC1 = store.character(c1.id);
  const untouchedC2 = store.character(c2.id);

  assert.equal(updatedC1.model, "chatgpt-4o-latest");
  assert.equal(updatedC1.contextBudget, 80000);
  assert.equal(untouchedC2.model, "o3-mini");
  assert.equal(untouchedC2.connectionId, conn.id);
});

test("model keşfi hatayı gizlemez, anahtarı sızdırmaz ve native sayfaları birleştirir", async (t) => {
  const routes = [];
  const server = http.createServer((req, res) => {
    routes.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/failure")) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: "secret-test-key" } }));
    } else if (req.url.startsWith("/anthropic")) {
      res.end(
        JSON.stringify(
          req.url.includes("after_id=")
            ? { data: [{ id: "claude-b" }], has_more: false }
            : {
                data: [{ id: "claude-a" }],
                has_more: true,
                last_id: "claude-a",
              },
        ),
      );
    } else if (req.url.startsWith("/gemini")) {
      res.end(
        JSON.stringify(
          req.url.includes("pageToken=")
            ? {
                models: [
                  {
                    name: "models/gemini-b",
                    supportedGenerationMethods: ["generateContent"],
                  },
                ],
              }
            : {
                models: [
                  {
                    name: "models/embedding",
                    supportedGenerationMethods: ["embedContent"],
                  },
                  {
                    name: "models/gemini-a",
                    supportedGenerationMethods: ["generateContent"],
                  },
                ],
                nextPageToken: "page-2",
              },
        ),
      );
    } else res.end(JSON.stringify({ data: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const adapter of ["compatible", "anthropic", "gemini", "ollama"]) {
    await assert.rejects(
      discoverModels(
        { adapter, baseUrl: `${base}/failure` },
        "secret-test-key",
      ),
      (error) => {
        assert.equal(error.status, 401);
        assert(!error.message.includes("secret-test-key"));
        return true;
      },
    );
  }
  assert.deepEqual(
    await discoverModels(
      { adapter: "anthropic", baseUrl: `${base}/anthropic` },
      "",
    ),
    ["claude-a", "claude-b"],
  );
  assert.deepEqual(
    await discoverModels({ adapter: "gemini", baseUrl: `${base}/gemini` }, ""),
    ["gemini-a", "gemini-b"],
  );
  assert(routes.includes("/anthropic/models?limit=100&after_id=claude-a"));
  assert(routes.includes("/gemini/models?pageSize=100&pageToken=page-2"));
  assert.deepEqual(
    await discoverModels({ adapter: "compatible", baseUrl: base }, ""),
    [],
  );
  await assert.rejects(
    complete(
      { adapter: "anthropic" },
      "",
      { model: "" },
      [],
      new AbortController().signal,
    ),
    /model kimliği/,
  );
});

test("grup yalnızca kayıtlı kişilerle kurulur ve tercihleri yeniden açılışta korunur", (t) => {
  const { store, root, a, b, chat } = fixture(t);
  assert.throws(
    () => store.createChat({ name: "Boş", participantIds: [] }),
    /kayıtlı kişi/,
  );
  assert.throws(
    () => store.createChat({ name: "Geçersiz", participantIds: ["missing"] }),
    /bulunamadı/,
  );
  assert.throws(
    () =>
      store.createChat({
        name: "Birebir",
        participantIds: [a.id, b.id],
        kind: "direct",
      }),
    /tek kişi/,
  );
  assert.throws(
    () => store.updateGroup({ id: chat.id, heartbeatSeconds: -1 }),
    /Heartbeat/,
  );
  assert.throws(
    () => store.updateGroup({ id: chat.id, maxParallel: 9 }),
    /Eşzamanlı/,
  );
  store.updateGroup({
    id: chat.id,
    heartbeatSeconds: 5,
    maxParallel: 2,
    memberPreferences: {
      [a.id]: { replyStyle: "detailed", respondToPeers: false },
    },
  });
  store.append("chat.updated", { id: chat.id, observer: true });
  assert.throws(
    () => store.updateGroup({ id: chat.id, heartbeatSeconds: 1 }),
    /yazışmasına/,
  );
  const restored = new Store(root).chat(chat.id);
  assert.equal(restored.heartbeatSeconds, 5);
  assert.equal(restored.maxParallel, 2);
  assert.deepEqual(restored.memberPreferences[a.id], {
    replyStyle: "detailed",
    respondToPeers: false,
  });
});

test("serbest grupta kişiler bağımsız ve eşzamanlı cevap verir, grup kapasitesi korunur", async (t) => {
  const { store, chat, connection, a, b, vault } = fixture(t);
  store.append("connection.updated", { id: connection.id, concurrency: 2 });
  store.updateGroup({ id: chat.id, maxParallel: 2, heartbeatSeconds: 0 });
  const started = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runtime = new Runtime(store, vault, async (_conn, _key, person) => {
    started.push(person.id);
    await gate;
    return { content: "[BEKLE]" };
  });
  t.after(() => {
    release();
    runtime.close();
  });
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "İkiniz de değerlendirin",
    to: ["all"],
  });
  runtime.tick();
  assert.deepEqual(new Set(started), new Set([a.id, b.id]));
  assert.equal(runtime.active.size, 2);
  release();
  await waitFor(() => runtime.active.size === 0);
  started.length = 0;
  store.updateGroup({ id: chat.id, maxParallel: 1 });
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Kapasiteyi dene",
    to: ["all"],
  });
  runtime.tick();
  assert.equal(started.length, 1);
  await waitFor(() => started.length === 2);
});

test("heartbeat yalnızca yeni teslimleri kontrol eder, boşta model çağırmaz ve kişi alışkanlıkları uygulanır", async (t) => {
  const { store, chat, a, b, vault } = fixture(t);
  store.updateGroup({
    id: chat.id,
    heartbeatSeconds: 30,
    memberPreferences: {
      [b.id]: { replyStyle: "detailed", respondToPeers: false },
    },
  });
  const calls = [];
  const runtime = new Runtime(
    store,
    vault,
    async (_conn, _key, person, messages) => {
      calls.push({ person: person.id, system: messages[0].content });
      return { content: "[BEKLE]" };
    },
  );
  t.after(() => runtime.close());
  runtime.tick();
  assert.equal(calls.length, 0);
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Bora cevap versin",
    to: [b.id],
  });
  runtime.tick();
  assert.equal(calls.length, 0);
  runtime.resetHeartbeat(chat.id);
  runtime.tick();
  assert.equal(calls.length, 1);
  assert(calls[0].system.includes("ayrıntılı açıkla"));
  await waitFor(() => runtime.active.size === 0);
  store.acceptMessage(a.id, {
    chatId: chat.id,
    content: "Bora'ya bir not",
    to: [b.id],
  });
  runtime.resetHeartbeat(chat.id);
  runtime.tick();
  assert.equal(calls.length, 1);
  assert.equal(store.state.runs.length, 1);
});

test("kaldırılan pano olayları geçmişi değiştirmeden okunur", (t) => {
  const { root, store, chat } = fixture(t);
  const message = store.acceptMessage("user", {
    chatId: chat.id,
    content: "Korunan sohbet mesajı.",
  });
  const note = store.append("decision.created", {
    id: id(),
    chatId: chat.id,
    content: "Eski pano kaydı",
  });
  store.append("decision.updated", { id: note.id, content: "Eski güncelleme" });
  const journal = fs.readFileSync(store.file, "utf8");
  const restored = new Store(root);
  assert(!Object.hasOwn(restored.state, "decisions"));
  assert.equal(
    restored.state.messages.find((m) => m.id === message.id).content,
    message.content,
  );
  assert.equal(fs.readFileSync(restored.file, "utf8"), journal);
});

test("eski birebir gözlem tercihi yeni kontrol olayıyla kapatılır", (t) => {
  const { root, store, a } = fixture(t);
  const direct = store.createChat({
    name: "Birebir",
    kind: "direct",
    participantIds: [a.id],
  });
  store.append("chat.updated", { id: direct.id, observer: true });
  const journal = fs.readFileSync(store.file, "utf8");
  const restored = new Store(root);
  assert.equal(restored.chat(direct.id).observer, false);
  assert(fs.readFileSync(restored.file, "utf8").startsWith(journal));
  assert.deepEqual(restored.events.at(-1).data, {
    id: direct.id,
    observer: false,
  });
});

test("model çağrısına verilen bağlam okundu sayılır; başka kimliğin makbuzu değişmez", async (t) => {
  const { store, vault, chat, a, b } = fixture(t);
  const privateMessage = store.acceptMessage("user", {
    chatId: chat.id,
    content: "Bora'ya özel",
    to: [b.id],
  });
  const source = store.acceptMessage("user", {
    chatId: chat.id,
    content: "Ada'ya özel",
    to: [a.id],
  });
  store.append("character.updated", { id: b.id, enabled: false });
  const runtime = new Runtime(store, vault, async () => {
    throw new Error("Test sağlayıcı hatası");
  });
  t.after(() => runtime.close());
  runtime.tick();
  await waitFor(() => store.state.runs.some((r) => r.status === "error"));
  assert(source.readTimes[a.id]);
  assert(!source.readTimes[b.id]);
  assert(!privateMessage.readTimes[a.id]);
  assert(!privateMessage.readTimes[b.id]);
});

test("kişi ve grup silme kontrol olayları ekler, geçmişi korur ve yeniden açılışta kalıcıdır", (t) => {
  const { store, chat, a, b } = fixture(t);
  const message = store.acceptMessage(a.id, {
    chatId: chat.id,
    content: "Korunacak geçmiş",
    to: ["user"],
  });
  const journalBefore = fs.readFileSync(store.file, "utf8");
  store.deleteCharacter(a.id);
  assert(store.character(a.id).deleted);
  assert(!store.character(a.id).enabled);
  assert.deepEqual(chat.participantIds, [b.id]);
  assert.throws(
    () => store.createChat({ name: "Silinen kişi", participantIds: [a.id] }),
    /Silinmiş/,
  );
  store.deleteChat(chat.id);
  assert(chat.deleted);
  assert.equal(chat.status, "closed");
  assert.throws(
    () =>
      store.acceptMessage("user", { chatId: chat.id, content: "Yayınlanamaz" }),
    /kapalı/,
  );
  assert(fs.readFileSync(store.file, "utf8").startsWith(journalBefore));
  const restored = new Store(store.root);
  assert(restored.character(a.id).deleted);
  assert(restored.chat(chat.id).deleted);
  assert.equal(
    restored.state.messages.find((m) => m.id === message.id).content,
    message.content,
  );
});

test("gözlemde kullanıcı okuma veya silme kontrol olayı oluşturamaz; durdurulan sohbet dış yanıt kabul etmez", (t) => {
  const { store, chat, a } = fixture(t);
  const message = store.acceptMessage(a.id, {
    chatId: chat.id,
    content: "Gözlem",
    to: ["user"],
  });
  store.append("chat.updated", { id: chat.id, observer: true });
  const count = store.events.length;
  assert.throws(
    () => store.markRead(chat.id, "user", message.id),
    /salt okunur/,
  );
  assert.throws(() => store.deleteChat(chat.id), /salt okunur/);
  assert.throws(() => store.deleteCharacter(a.id), /gözlemden çık/);
  assert.equal(store.events.length, count);
  store.append("chat.updated", {
    id: chat.id,
    observer: false,
    waiting: false,
  });
  assert.throws(
    () =>
      store.acceptMessage(a.id, {
        chatId: chat.id,
        content: "Geç yanıt",
        to: ["user"],
      }),
    /durduruldu/,
  );
});

test("sol panel sırası bölümler arasında karışmaz ve yeniden açılışta korunur", (t) => {
  const { store, root, a, b, chat } = fixture(t);
  const second = store.cloneGroup(chat.id, "İkinci grup");
  const before = fs.readFileSync(store.file, "utf8");
  store.reorderSidebar("people", [b.id, a.id]);
  store.reorderSidebar("groups", [second.id, chat.id]);
  assert.throws(() => store.reorderSidebar("people", [chat.id]), /Geçersiz/);
  assert.throws(() => store.reorderSidebar("people", [a.id, a.id]), /Geçersiz/);
  const restored = new Store(root);
  assert.deepEqual(restored.state.sidebarOrder, {
    people: [b.id, a.id],
    groups: [second.id, chat.id],
  });
  assert(fs.readFileSync(store.file, "utf8").startsWith(before));
});

test("kişi arşivleme yanıtları durdurur, geçmişi korur, önceki durumu geri yükler", (t) => {
  const { store, root, a, b, chat } = fixture(t);
  const direct = store.createChat({
    name: a.name,
    kind: "direct",
    participantIds: [a.id],
  });
  const message = store.acceptMessage("user", {
    chatId: direct.id,
    content: "Geçmiş kalacak",
    to: [a.id],
  });
  store.archiveCharacter(a.id, true);
  assert.equal(a.enabled, false);
  assert.equal(a.archived, true);
  assert.equal(direct.status, "closed");
  assert(chat.participantIds.includes(a.id));
  assert.throws(
    () =>
      store.acceptMessage(a.id, {
        chatId: chat.id,
        content: "Geç yanıt",
        to: ["user"],
      }),
    /durduruldu/,
  );
  const restored = new Store(root);
  assert.equal(restored.character(a.id).archived, true);
  restored.archiveCharacter(a.id, false);
  assert.equal(restored.character(a.id).enabled, true);
  assert.equal(restored.chat(direct.id).status, "open");
  assert.equal(
    restored.state.messages.find((m) => m.id === message.id).content,
    "Geçmiş kalacak",
  );
  store.append("character.updated", { id: b.id, enabled: false });
  store.archiveCharacter(b.id, true);
  store.archiveCharacter(b.id, false);
  assert.equal(b.enabled, false);
});

test("grup çoğaltma ayar ve üyeliği taşır, mesajları ve çalışma kimliklerini paylaşmaz", (t) => {
  const { store, chat, a } = fixture(t);
  store.updateGroup({
    id: chat.id,
    heartbeatSeconds: 3,
    maxParallel: 2,
    memberPreferences: {
      [a.id]: { replyStyle: "concise", respondToPeers: false },
    },
  });
  store.acceptMessage("user", {
    chatId: chat.id,
    content: "Yalnızca asıl grup",
    to: ["all"],
  });
  store.archiveCharacter(a.id, true);
  const copy = store.cloneGroup(chat.id, "Çoğaltılmış grup");
  assert.notEqual(copy.id, chat.id);
  assert.notEqual(copy.topicId, chat.topicId);
  assert.deepEqual(copy.participantIds, chat.participantIds);
  assert.deepEqual(copy.memberPreferences, chat.memberPreferences);
  assert.equal(copy.heartbeatSeconds, 3);
  assert.equal(copy.turnCount, 0);
  assert.equal(
    store.state.messages.filter((m) => m.chatId === copy.id).length,
    0,
  );
});

test("profil fotoğrafı boyut ve biçim sınırıyla kaydedilir; dosya yolu ve SVG reddedilir", (t) => {
  const { store, root, connection } = fixture(t);
  const photo =
    "data:image/png;base64," +
    fs
      .readFileSync(new URL("../public/brand/icon-256.png", import.meta.url))
      .toString("base64");
  const c = store.createCharacter({
    name: "Fotoğraflı",
    model: "local",
    connectionId: connection.id,
    photo,
  });
  const chat = store.createChat({
    name: "Fotoğraflı grup",
    participantIds: [c.id],
    photo,
  });
  assert.equal(new Store(root).character(c.id).photo, photo);
  assert.equal(store.cloneGroup(chat.id, "Fotoğraf kopyası").photo, photo);
  for (const bad of [
    "file:///private/key",
    "data:image/svg+xml,<svg/>",
    "data:image/png;base64,abcd",
  ])
    assert.throws(
      () => store.updateGroup({ id: chat.id, photo: bad }),
      /Geçersiz profil/,
    );
});
