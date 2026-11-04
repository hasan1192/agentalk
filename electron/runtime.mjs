import {
  MediaUnsupported,
  mediaPartsFor,
  mediaExplanation,
} from "./media-provider.mjs";
import { id } from "./store.mjs";
import {
  buildContext,
  complete,
  parseReply,
  checkMediaSupport,
} from "./provider.mjs";

export class Runtime {
  constructor(store, vault, generate = complete) {
    this.store = store;
    this.vault = vault;
    this.generate = generate;
    this.active = new Map();
    this.stopped = false;
    this.lastHeartbeat = new Map();
    this.timer = setInterval(() => this.tick(), 500);
    this.syncPresence();
  }
  syncPresence() {
    for (const chat of this.store.state.chats) {
      for (const pid of chat.participantIds) {
        const character = this.store.character(pid);
        if (character.kind !== "api") continue;
        const online =
          !this.stopped &&
          character.enabled &&
          !character.deleted &&
          !character.archived &&
          !chat.deleted &&
          chat.status === "open";
        const working = [...this.active.values()].some(
          (a) => a.chatId === chat.id && a.characterId === pid,
        );
        this.store.setPresence(chat.id, pid, {
          online,
          source: "application-runtime",
          state: online
            ? working
              ? "working"
              : chat.waiting
                ? "waiting"
                : "paused"
            : "offline",
          expiresAt: null,
        });
      }
    }
  }
  resetHeartbeat(chatId) {
    this.lastHeartbeat.delete(chatId);
  }
  reconcile() {
    const now = Date.now();
    const readyChats = new Set();
    for (const chat of this.store.state.chats) {
      if (
        now - (this.lastHeartbeat.get(chat.id) || 0) >=
        (chat.heartbeatSeconds ?? 0) * 1000
      ) {
        readyChats.add(chat.id);
        this.lastHeartbeat.set(chat.id, now);
      }
    }
    for (const message of this.store.state.messages) {
      if (message.deleted || !readyChats.has(message.chatId)) continue;
      const chat = this.store.chat(message.chatId);
      if (
        !chat.waiting ||
        chat.status !== "open" ||
        message.topicId !== chat.topicId
      )
        continue;
      if (chat.maxTurns > 0 && (chat.turnCount || 0) >= chat.maxTurns) continue;

      let targetRecipients = message.recipients.filter((x) => x !== "user");

      if (chat.mode === "mention_only") {
        if (message.to.includes("all")) {
          targetRecipients = [];
        } else {
          targetRecipients = targetRecipients.filter((r) =>
            message.to.includes(r),
          );
        }
      }

      for (const recipient of targetRecipients) {
        const c = this.store.character(recipient);
        const respondToPeers =
          chat.memberPreferences?.[recipient]?.respondToPeers ??
          chat.respondToPeers ??
          true;
        if (message.from !== "user" && !respondToPeers) continue;
        if (
          c.kind !== "api" ||
          !c.enabled ||
          this.store.state.runs.some(
            (r) => r.messageId === message.id && r.characterId === recipient,
          )
        )
          continue;
        this.store.append("run.created", {
          id: id(),
          chatId: chat.id,
          characterId: c.id,
          messageId: message.id,
          topicId: message.topicId,
          status: "queued",
        });
      }
    }
  }
  tick() {
    if (this.stopped) return;
    this.syncPresence();
    this.reconcile();
    for (const [runId, active] of this.active.entries()) {
      const run = this.store.state.runs.find((r) => r.id === runId);
      if (run) {
        const source = this.store.state.messages.find(
          (m) => m.id === run.messageId,
        );
        if (source && source.deleted) {
          active.controller.abort();
        }
      }
    }
    for (const run of this.store.state.runs.filter(
      (x) => x.status === "queued",
    )) {
      const chat = this.store.chat(run.chatId);
      if (chat.status !== "open" || chat.topicId !== run.topicId) {
        this.store.append("run.updated", {
          id: run.id,
          status: "cancelled",
          error: "Eski konu kuyruğu korundu; otomatik yanıt üretmez.",
        });
        continue;
      }
      const source = this.store.state.messages.find(
        (m) => m.id === run.messageId,
      );
      if (source && source.deleted) {
        this.store.append("run.updated", {
          id: run.id,
          status: "cancelled",
          error: "Kaynak mesaj silindi.",
        });
        continue;
      }
      if (
        [...this.active.values()].filter((x) => x.chatId === chat.id).length >=
        (chat.maxParallel || 4)
      )
        continue;
      const c = this.store.character(run.characterId);
      if (
        !chat.waiting ||
        !c.enabled ||
        [...this.active.values()].some((x) => x.characterId === c.id)
      )
        continue;
      const connection = this.store.state.connections.find(
        (x) => x.id === c.connectionId,
      );
      if (!connection) {
        this.store.append("run.updated", {
          id: run.id,
          status: "error",
          error: "Bağlantı bulunamadı.",
        });
        continue;
      }
      if (
        [...this.active.values()].filter(
          (x) => x.connectionId === connection.id,
        ).length >= connection.concurrency
      )
        continue;
      // Every dispatch occupies the slot before the first await.
      this.execute(run, c, connection).catch(() => {});
    }
  }
  async execute(run, character, connection) {
    const controller = new AbortController();
    this.active.set(run.id, {
      controller,
      chatId: run.chatId,
      characterId: character.id,
      connectionId: connection.id,
    });
    this.syncPresence();
    const usage = {};
    const status = (status, extra = {}) =>
      this.store.append("run.updated", { id: run.id, status, ...extra });
    try {
      const chat = this.store.chat(run.chatId);
      const source = this.store.state.messages.find(
        (x) => x.id === run.messageId,
      );
      if (!source || source.deleted) {
        status("cancelled", {
          error: "Kaynak mesaj silindi; çalışma iptal edildi.",
        });
        return;
      }
      const { messages, context } = buildContext(
        this.store.state,
        chat,
        character,
        source,
      );
      const checkDocumentBudget = () => {
        const parts = messages.flatMap((m) => m.mediaParts || []);
        if (
          parts.length > 6 ||
          parts.reduce((n, p) => n + p.bytes, 0) > 16 * 1024 * 1024
        )
          throw new MediaUnsupported(
            parts.map((p) => p.kind),
            "limit",
          );
        const documentCharacters = parts.reduce(
          (n, p) => n + (p.text?.length || 0),
          0,
        );
        if (
          documentCharacters &&
          context.characters + documentCharacters > character.contextBudget
        )
          throw new MediaUnsupported(["document"], "limit");
      };
      // These messages are being supplied to this identity's model call.
      // Reading is independent of delivery acknowledgements and reply success.
      for (const messageId of context.messageIds)
        this.store.markRead(chat.id, character.id, messageId);
      for (const message of messages) {
        if (message.mediaIds?.length)
          message.mediaParts = await mediaPartsFor(
            this.store,
            chat.id,
            character.id,
            message.mediaIds,
            connection.adapter,
            controller.signal,
          );
      }
      checkDocumentBudget();
      status("running", { context, error: "" });
      const key = this.vault.get(connection.id);
      let result, reply;
      const pending = [];
      try {
        for (let step = 0; step < 3; step++) {
          const inputMedia = messages.flatMap((m) => m.mediaParts || []);
          if (inputMedia.length)
            await checkMediaSupport(
              connection,
              key,
              character,
              inputMedia,
              controller.signal,
            );
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              result = await this.generate(
                connection,
                key,
                character,
                messages,
                controller.signal,
              );
              break;
            } catch (error) {
              if (
                error.status !== 429 ||
                attempt === 2 ||
                controller.signal.aborted
              )
                throw error;
              status("running", {
                error: `Sağlayıcı beklemesi · yeniden deneme ${attempt + 1}/2`,
              });
              await new Promise((resolve, reject) => {
                const abort = () => {
                  clearTimeout(timer);
                  reject(new Error("İptal edildi."));
                };
                const timer = setTimeout(
                  () => {
                    controller.signal.removeEventListener("abort", abort);
                    resolve();
                  },
                  (attempt + 1) * 2500,
                );
                controller.signal.addEventListener("abort", abort, {
                  once: true,
                });
              });
            }
          }
          if (
            controller.signal.aborted ||
            chat.topicId !== run.topicId ||
            chat.status !== "open" ||
            !chat.waiting ||
            source.deleted ||
            !character.enabled
          ) {
            status("cancelled", {
              error: source.deleted ? "Mesaj silindi; yanıt yayınlanmadı." : "",
            });
            return;
          }
          for (const [name, value] of Object.entries(result.usage || {})) {
            if (typeof value === "number" && Number.isFinite(value))
              usage[name] = (usage[name] || 0) + value;
          }
          reply = result.content?.trim()
            ? parseReply(result.content, source.from)
            : { content: "", to: [source.from] };
          if (!reply?.inspectMedia) break;
          if (step === 2)
            throw new MediaUnsupported(["image", "audio", "video"], "limit");
          const requested = await mediaPartsFor(
            this.store,
            chat.id,
            character.id,
            reply.inspectMedia,
            connection.adapter,
            controller.signal,
          );
          // Keep only the requested bytes; earlier media remains in the descriptive catalogue.
          for (const m of messages) delete m.mediaParts;
          messages.push({
            role: "user",
            content:
              "İstediğin medya dosyaları aşağıdadır. İncele ve kullanıcıya yanıt ver.",
            mediaParts: requested,
          });
          checkDocumentBudget();
          status("running", {
            context: { ...context, mediaIds: reply.inspectMedia },
          });
        }
        if (
          (result.mediaOutputs?.length || 0) +
            (reply?.attachments?.length || 0) >
          6
        )
          throw new MediaUnsupported(["image", "audio", "video"], "limit");
        for (const output of result.mediaOutputs || []) {
          if (
            !/^(image|audio|video)\//.test(output.mime || "") ||
            typeof output.data !== "string" ||
            output.data.length > 17 * 1024 * 1024 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(output.data)
          )
            throw new Error("Modelin medya yanıtı geçersiz veya çok büyük.");
          pending.push(
            await this.store.media.stage(
              chat.id,
              character.id,
              run.topicId,
              output.name,
              Buffer.from(output.data, "base64"),
            ),
          );
        }
        if (pending.length)
          reply = {
            ...(reply || { content: "", to: [source.from] }),
            attachments: [...(reply?.attachments || []), ...pending],
          };
        if (
          controller.signal.aborted ||
          chat.topicId !== run.topicId ||
          chat.status !== "open" ||
          !chat.waiting ||
          source.deleted ||
          !character.enabled
        ) {
          status("cancelled", { error: "" });
          return;
        }
        if (reply)
          this.store.acceptMessage(character.id, {
            ...reply,
            id: `reply-${run.id}`,
            chatId: chat.id,
            topicId: run.topicId,
            replyTo: source.id,
          });
      } finally {
        for (const a of pending) this.store.media.discard(a.id, character.id);
      }
      status(reply ? "done" : "skipped", { usage, error: "" });
    } catch (error) {
      const chat = this.store.chat(run.chatId);
      const source = this.store.state.messages.find(
        (m) => m.id === run.messageId,
      );
      if (
        error instanceof MediaUnsupported &&
        !controller.signal.aborted &&
        source &&
        !source.deleted &&
        chat.status === "open" &&
        chat.waiting &&
        chat.topicId === run.topicId &&
        character.enabled
      ) {
        this.store.acceptMessage(character.id, {
          id: `reply-${run.id}`,
          chatId: chat.id,
          topicId: run.topicId,
          replyTo: source.id,
          to: [source.from],
          content: mediaExplanation(
            this.store.state,
            error.kinds,
            error.reason,
          ),
        });
        status("done", { error: "", mediaNotice: error.reason, usage });
        return;
      }
      status(controller.signal.aborted ? "cancelled" : "error", {
        error: error.message,
        ...(Object.keys(usage).length ? { usage } : {}),
        ...(error.context ? { context: error.context } : {}),
      });
    } finally {
      this.active.delete(run.id);
      if (!this.stopped) {
        Promise.resolve().then(() => this.tick());
      }
    }
  }
  cancel(chatId) {
    for (const value of this.active.values())
      if (value.chatId === chatId) value.controller.abort();
    for (const run of this.store.state.runs.filter(
      (r) => r.chatId === chatId && ["queued", "running"].includes(r.status),
    ))
      this.store.append("run.updated", {
        id: run.id,
        status: "cancelled",
        error: "Kullanıcı durdurdu; çalışma kaydı korundu.",
      });
  }
  cancelRun(runId) {
    const active = this.active.get(runId);
    if (active) active.controller.abort();
    const run = this.store.state.runs.find((r) => r.id === runId);
    if (run && ["queued", "running"].includes(run.status)) {
      this.store.append("run.updated", {
        id: run.id,
        status: "cancelled",
        error: "Kullanıcı durdurdu; çalışma kaydı korundu.",
      });
    }
  }
  close() {
    this.stopped = true;
    this.syncPresence();
    clearInterval(this.timer);
    for (const value of this.active.values()) value.controller.abort();
  }
}
