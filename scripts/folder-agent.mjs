import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const [folder, action, value, recipient = "user"] = process.argv.slice(2);
if (
  !folder ||
  !["inbox", "send", "send-media", "receipt", "ack", "listen"].includes(action)
) {
  console.log(
    'Kullanım: node scripts/folder-agent.mjs <katılımcı-klasörü> inbox | send "mesaj" [alıcı] | send-media <dosya> [alıcı] | receipt <teslim-sırası> | ack <teslim-sırası> | listen',
  );
  process.exit(1);
}

function loadConfig() {
  const file = path.join(folder, "bridge.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `bridge.json bulunamadı: ${file}. Katılımcı klasörünün doğru olduğundan emin olun.`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

if (action === "listen") {
  console.log(`[Dinleyici] Başlatıldı: ${folder}`);
  console.log(
    "[Dinleyici] Yeni teslimatlar bekleniyor... (Durdurmak için Ctrl+C)\n",
  );
  let lastProcessed = 0;
  const cursorFile = path.join(folder, "receipts", "cursor.json");
  if (fs.existsSync(cursorFile)) {
    try {
      const cur = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
      lastProcessed = Number(cur.deliverySequence) || 0;
    } catch {}
  }

  const sessionId = randomUUID();
  const call = async (config, route, body) => {
    const response = await fetch(`${config.endpoint}/${route}`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  };
  let polling = false;
  const loop = async () => {
    if (polling) return;
    polling = true;
    try {
      const config = loadConfig();
      await call(config, "heartbeat", { sessionId, typing: false });
      const inboxDir = path.join(folder, "inbox");
      if (fs.existsSync(inboxDir)) {
        const files = fs
          .readdirSync(inboxDir)
          .filter((f) => /^\d{6}-.*\.json$/.test(f))
          .sort();
        for (const file of files) {
          const data = JSON.parse(
            fs.readFileSync(path.join(inboxDir, file), "utf8"),
          );
          if (data.deliverySequence <= lastProcessed) continue;
          console.log(
            `\n[Yeni Mesaj] Teslim No: ${data.deliverySequence} | Gönderen: ${data.message.from} | Konu: ${data.message.topicId}`,
          );
          console.log(`İçerik: ${data.message.content}`);
          for (const media of data.message.attachments || [])
            console.log(
              `Dosya: ${media.name} (${media.mime}) → ${media.path} | Konum: ${JSON.stringify(media.placement)}`,
            );
          // Only contents actually read and displayed get a read event.
          await call(config, "read", { messageId: data.message.id });
          await call(config, "receipt", {
            deliverySequence: data.deliverySequence,
          });
          lastProcessed = data.deliverySequence;
        }
      }
    } catch (err) {
      console.error("[Dinleyici Hatası]", err.message);
    } finally {
      polling = false;
    }
  };
  await loop();
  const interval = setInterval(loop, 1200);
  const stop = async () => {
    clearInterval(interval);
    try {
      await call(loadConfig(), "heartbeat", { sessionId, online: false });
    } catch {}
    console.log("\n[Dinleyici] Durduruldu.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // Keep alive
  await new Promise(() => {});
} else {
  const config = loadConfig();
  let attachment;
  if (action === "send-media") {
    if (!value || fs.statSync(value).size > 100 * 1024 * 1024)
      throw new Error("En fazla 100 MB medya dosyası seç.");
    const name = `${randomUUID()}-${path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const dir = path.join(folder, "outbox", "media");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.copyFileSync(value, path.join(dir, name));
    attachment = { path: `outbox/media/${name}` };
  }
  const route = ["send", "send-media"].includes(action)
    ? "message"
    : action === "ack"
      ? "receipt"
      : action;
  const body = ["send", "send-media"].includes(action)
    ? {
        id: randomUUID(),
        topicId: config.topicId,
        content: action === "send-media" ? "" : value,
        ...(attachment ? { attachments: [attachment] } : {}),
        to: [recipient],
      }
    : { deliverySequence: Number(value) };
  const result = await fetch(`${config.endpoint}/${route}`, {
    method: action === "inbox" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    ...(action === "inbox" ? {} : { body: JSON.stringify(body) }),
  });
  const data = await result.json();
  console.log(JSON.stringify(data, null, 2));
  if (!result.ok || data.status === "error") process.exitCode = 1;
}
