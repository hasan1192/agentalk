import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { atomicJSON } from "./store.mjs";

export class Bridge {
  constructor(store, vault, onMessage) {
    this.store = store;
    this.vault = vault;
    this.onMessage = onMessage;
    this.port = 0;
    this.busy = false;
    this.sessions = new Map();
  }
  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = this.server.address().port;
    this.sync();
    this.timer = setInterval(() => {
      this.pollOutboxes().catch(() => {});
      let expired = false;
      for (const [key, value] of this.sessions) {
        if (value.expiresAt <= Date.now()) {
          this.sessions.delete(key);
          expired = true;
        }
      }
      this.sync();
      if (expired) this.onMessage();
    }, 1500);
  }
  getTyping(chatId, participantId) {
    const s = this.sessions.get(`${chatId}:${participantId}`);
    return Boolean(s && s.expiresAt > Date.now() && s.typing);
  }
  syncPresence(chatId, participantId) {
    const s = this.sessions.get(`${chatId}:${participantId}`);
    const chat = this.store.chat(chatId),
      character = this.store.character(participantId);
    const online = Boolean(
      s &&
      s.expiresAt > Date.now() &&
      character.enabled &&
      !character.deleted &&
      !character.archived &&
      !chat.deleted &&
      chat.status === "open",
    );
    this.store.setPresence(chatId, participantId, {
      online,
      state: online ? (s.typing ? "working" : "waiting") : "offline",
      source: "authenticated-bridge",
      expiresAt: online ? new Date(s.expiresAt).toISOString() : null,
      ...(online ? { lastSeenAt: new Date(s.lastSeenAt).toISOString() } : {}),
    });
  }
  setTyping(chatId, participantId, typing) {
    const key = `${chatId}:${participantId}`;
    const s = this.sessions.get(key) || {
      sessionId: "default",
      expiresAt: Date.now() + 30000,
    };
    s.typing = Boolean(typing);
    s.expiresAt = Date.now() + 30000;
    s.lastSeenAt = Date.now();
    this.sessions.set(key, s);
    this.syncPresence(chatId, participantId);
    this.onMessage();
  }
  acquireSession(chatId, participantId, sessionId) {
    const key = `${chatId}:${participantId}`;
    const now = Date.now();
    const current = this.sessions.get(key);
    if (
      current &&
      current.expiresAt > now &&
      sessionId &&
      current.sessionId !== sessionId
    ) {
      const err = new Error(
        "Aynı katılımcı için başka bir aktif dinleyici oturumu çalışıyor.",
      );
      err.status = 409;
      throw err;
    }
    this.sessions.set(key, {
      sessionId: sessionId || "default",
      expiresAt: now + 30000,
      lastSeenAt: now,
      typing: current ? current.typing : false,
    });
    this.syncPresence(chatId, participantId);
    this.onMessage();
    return true;
  }
  credential(chatId, participantId) {
    const key = `bridge:${chatId}:${participantId}`;
    let token = this.vault.get(key);
    if (!token) {
      token = randomBytes(32).toString("hex");
      this.vault.set(key, token);
    }
    return token;
  }
  sync() {
    for (const chat of this.store.state.chats) {
      for (const pid of chat.participantIds.filter(
        (pid) => this.store.character(pid).kind === "folder",
      )) {
        this.syncPresence(chat.id, pid);
        if (!this.vault.available()) return;
        atomicJSON(
          path.join(this.store.participantPath(chat.id, pid), "bridge.json"),
          {
            schemaVersion: 1,
            chatId: chat.id,
            participantId: pid,
            endpoint: `http://127.0.0.1:${this.port}/v1/${chat.id}/${pid}`,
            token: this.credential(chat.id, pid),
            topicId: chat.topicId,
            note: "Bu erişim yalnızca bu kimliğin mesaj kutusuna aittir. Klasör ayrımı işletim sistemi sandboxı değildir.",
          },
        );
      }
    }
  }
  authenticate(chatId, pid, token) {
    this.store.participantPath(chatId, pid);
    if (pid === "user" || this.store.character(pid).kind !== "folder")
      throw new Error("Dış ajan kimliği gerekli.");
    if (this.store.chat(chatId).deleted || this.store.character(pid).deleted)
      throw new Error("Silinmiş kişi veya gruba erişilemez.");
    const expected = this.credential(chatId, pid);
    const actual = Buffer.from(typeof token === "string" ? token : "");
    const target = Buffer.from(expected);
    if (actual.length !== target.length || !timingSafeEqual(actual, target))
      throw new Error("Kimlik doğrulanamadı.");
  }
  async handle(req, res) {
    const send = (code, value) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      // Browser pages cannot use this local agent bridge.
      if (req.headers.origin) {
        send(403, { error: "Tarayıcı kökenlerine açık değil." });
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const match = url.pathname.match(
        /^\/v1\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/(inbox|message|receipt|ack|heartbeat|read|typing|media\/[a-zA-Z0-9_-]+)$/,
      );
      if (!match) {
        send(404, { error: "Uç nokta bulunamadı." });
        return;
      }
      const [, chatId, pid, action] = match;
      this.authenticate(
        chatId,
        pid,
        req.headers.authorization?.replace(/^Bearer /, ""),
      );
      if (action.startsWith("media/") && req.method === "GET") {
        const mediaId = action.slice(6);
        if (!this.store.canReadMedia(chatId, pid, mediaId))
          throw new Error("Bu medyaya erişim yetkiniz yok.");
        const asset = this.store.media.record(chatId, mediaId);
        res.writeHead(200, {
          "Content-Type": asset.mime,
          "Content-Length": asset.bytes,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(this.store.media.file(chatId, mediaId)).pipe(res);
        return;
      }
      if (action === "inbox" && req.method === "GET") {
        this.acquireSession(chatId, pid, req.headers["x-session-id"]);
        send(200, {
          messages: this.store.inbox(chatId, pid),
          topicId: this.store.chat(chatId).topicId,
        });
        return;
      }
      if (req.method !== "POST") {
        send(405, { error: "Yöntem geçersiz." });
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 24 * 1024 * 1024) throw new Error("Mesaj çok uzun.");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const data = body ? JSON.parse(body) : {};
      if (action === "message") {
        if (!data.topicId) throw new Error("Konu kimliği gerekli.");
        const prepared = data.attachments?.length
          ? await this.prepareMessage(chatId, pid, data)
          : data;
        const m = this.acceptPrepared(pid, { ...prepared, chatId });
        this.setTyping(chatId, pid, false);
        this.onMessage();
        send(200, { messageId: m.id });
      } else if (action === "receipt" || action === "ack") {
        this.store.receipt(chatId, pid, data.deliverySequence);
        send(200, { ok: true, deliverySequence: data.deliverySequence });
      } else if (action === "heartbeat") {
        this.acquireSession(chatId, pid, data.sessionId);
        if (data.online === false) {
          this.sessions.delete(`${chatId}:${pid}`);
          this.syncPresence(chatId, pid);
          this.onMessage();
        } else if (typeof data.typing === "boolean")
          this.setTyping(chatId, pid, data.typing);
        send(200, { ok: true, leaseExpiresAt: Date.now() + 30000 });
      } else if (action === "read") {
        this.store.markRead(chatId, pid, data.messageId);
        send(200, { ok: true });
      } else if (action === "typing") {
        this.setTyping(chatId, pid, Boolean(data.typing));
        send(200, { ok: true });
      } else send(404, { error: "Uç nokta bulunamadı." });
    } catch (error) {
      send(error.status || 400, { error: error.message });
    }
  }
  async prepareMessage(chatId, pid, data) {
    if (!Array.isArray(data.attachments) || data.attachments.length > 6)
      throw new Error("Geçersiz medya ekleri.");
    const inputs = data.attachments.map((ref) => {
      if (!ref || typeof ref !== "object")
        throw new Error("Geçersiz medya eki.");
      if (ref.id) return { id: ref.id, position: ref.position };
      if (ref.data) {
        if (
          typeof ref.data !== "string" ||
          ref.data.length > 17 * 1024 * 1024 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.data)
        )
          throw new Error("Geçersiz medya verisi.");
        return {
          hash: createHash("sha256").update(ref.data).digest("hex"),
          name: ref.name,
          settings: ref.settings,
          position: ref.position,
        };
      }
      const file = this.store.media.folderFile(this.store, chatId, pid, ref);
      return {
        hash: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        name: path.basename(file),
        settings: ref.settings,
        position: ref.position,
      };
    });
    const mediaRequestHash = createHash("sha256")
      .update(JSON.stringify(inputs))
      .digest("hex");
    const existing = this.store.state.messages.find(
      (m) => m.id === data.id && m.from === pid && m.chatId === chatId,
    );
    if (existing)
      return {
        ...data,
        mediaRequestHash,
        attachments: (existing.attachments || []).map((a, i) => ({
          ...a,
          position:
            data.attachments[i]?.position ?? String(data.content || "").length,
        })),
      };
    const chat = this.store.chat(chatId);
    if (
      !data.topicId ||
      chat.topicId !== data.topicId ||
      !chat.waiting ||
      chat.status !== "open" ||
      !this.store.character(pid).enabled
    )
      throw new Error("Eski konu veya durdurulmuş kişi medya gönderemez.");
    const attachments = [];
    try {
      for (const ref of data.attachments) {
        if (ref.id) attachments.push(ref);
        else if (typeof ref.data === "string") {
          if (
            ref.data.length > 17 * 1024 * 1024 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.data)
          )
            throw new Error("Geçersiz medya verisi.");
          attachments.push({
            ...(await this.store.media.stage(
              chatId,
              pid,
              data.topicId,
              ref.name,
              Buffer.from(ref.data, "base64"),
              ref.settings,
            )),
            position: ref.position,
          });
        } else
          attachments.push({
            ...(await this.store.media.importFolder(
              this.store,
              chatId,
              pid,
              data.topicId,
              ref,
            )),
            position: ref.position,
          });
      }
      return { ...data, attachments, mediaRequestHash };
    } catch (error) {
      for (const a of attachments) this.store.media.discard(a.id, pid);
      throw error;
    }
  }
  acceptPrepared(pid, data) {
    try {
      return this.store.acceptMessage(pid, data);
    } finally {
      for (const asset of data.attachments || [])
        this.store.media.discard(asset.id, pid);
    }
  }
  async pollOutboxes() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const chat of this.store.state.chats.filter(
        (c) => c.status === "open" && c.waiting,
      )) {
        for (const pid of chat.participantIds.filter(
          (pid) => this.store.character(pid).kind === "folder",
        )) {
          if (!this.vault.available()) return;
          const dir = this.store.participantPath(chat.id, pid);
          for (const name of fs
            .readdirSync(path.join(dir, "outbox"))
            .filter((x) => /^[a-zA-Z0-9_-]+\.json$/.test(x))) {
            const file = path.join(dir, "outbox", name);
            const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.size > 24 * 1024 * 1024) continue;
            let data;
            try {
              data = JSON.parse(fs.readFileSync(file, "utf8"));
              this.authenticate(chat.id, pid, data.token);
              if (name.startsWith("ack-") || data.action === "ack") {
                if (!Number.isInteger(data.deliverySequence))
                  throw new Error("Geçerli teslimat sıra numarası gerekli.");
                this.store.receipt(chat.id, pid, data.deliverySequence);
                atomicJSON(path.join(dir, "receipts", `${name}`), {
                  status: "accepted",
                  deliverySequence: data.deliverySequence,
                });
                fs.unlinkSync(file);
                this.onMessage();
                continue;
              }
              if (!data.id || !data.topicId)
                throw new Error("Mesaj ve konu kimliği gerekli.");
              const prepared = data.attachments?.length
                ? await this.prepareMessage(chat.id, pid, data)
                : data;
              const accepted = this.acceptPrepared(pid, {
                ...prepared,
                chatId: chat.id,
              });
              atomicJSON(path.join(dir, "receipts", `${name}`), {
                status: "accepted",
                messageId: accepted.id,
              });
              fs.unlinkSync(file);
              this.onMessage();
            } catch (error) {
              atomicJSON(path.join(dir, "receipts", `${name}`), {
                status: "error",
                error: error.message,
                quarantined: true,
                remediation:
                  "Zarf bridge.json içindeki güncel token ve topicId ile uyuşmalı ve geçerli bir id içermelidir.",
              });
              const qDir = path.join(dir, "quarantine");
              fs.mkdirSync(qDir, { recursive: true, mode: 0o700 });
              try {
                fs.renameSync(file, path.join(qDir, `${Date.now()}-${name}`));
              } catch {
                try {
                  fs.unlinkSync(file);
                } catch {}
              }
            }
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }
  close() {
    clearInterval(this.timer);
    this.server?.close();
    this.sessions.clear();
    this.sync();
  }
}
