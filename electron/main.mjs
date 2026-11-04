import { Readable } from "node:stream";
import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  dialog,
  protocol,
  net,
  session,
  Menu,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Store,
  atomicJSON,
  id,
  profilePhoto,
  validateMediaSupport,
  validateMediaOutput,
} from "./store.mjs";
import { Vault } from "./vault.mjs";
import { Runtime } from "./runtime.mjs";
import { Bridge } from "./bridge.mjs";
import { writeChatExport } from "./export.mjs";
import { discoverModels, validateConnection } from "./provider.mjs";
import { resolveLocale, translate } from "../src/locale.mjs";
import en from "../src/locales/en.json" with { type: "json" };
import de from "../src/locales/de.json" with { type: "json" };
import packageInfo from "../package.json" with { type: "json" };

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devURL = process.env.AGENTALK_DEV_URL;
protocol.registerSchemesAsPrivileged([
  {
    scheme: "agentalk-media",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    scheme: "agentalk",
    privileges: { secure: true, standard: true, supportFetchAPI: true },
  },
]);
app.setName("Agentalk");
if (process.env.AGENTALK_PROFILE_DIR) {
  fs.mkdirSync(process.env.AGENTALK_PROFILE_DIR, { recursive: true });
  app.setPath("userData", process.env.AGENTALK_PROFILE_DIR);
}
if (!app.requestSingleInstanceLock()) app.quit();
let window, store, vault, runtime, bridge;
const localize = (key) =>
  translate({ en, de }, store?.state.language || app.getLocale(), key);
const iconPath = path.join(base, "public", "brand", "icon-256.png");
function openSettings(tab) {
  window?.show();
  window?.focus();
  window?.webContents.send("agentalk:open-settings", tab);
}
function updateApplicationBrand() {
  app.setAboutPanelOptions({
    applicationName: "Agentalk",
    applicationVersion: packageInfo.version,
    version: packageInfo.version,
    credits: localize("Bağımsız sesler. Ortak bir sohbet."),
    iconPath,
  });
  const settingsItems = [
    {
      label: localize("Agentalk Hakkında"),
      click: () => openSettings("about"),
    },
    {
      label: localize("Ayarlar…"),
      accelerator: "CmdOrCtrl+,",
      click: () => openSettings("general"),
    },
    { type: "separator" },
  ];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      process.platform === "darwin"
        ? {
            label: "Agentalk",
            submenu: [
              ...settingsItems,
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit", label: localize("Agentalk’tan çık") },
            ],
          }
        : {
            label: localize("Dosya"),
            submenu: [
              ...settingsItems,
              { role: "quit", label: localize("Agentalk’tan çık") },
            ],
          },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}
const snapshot = () => {
  const typingPids = [
    ...new Set(
      store.state.runs
        .filter((r) => {
          const chat = store.state.chats.find((c) => c.id === r.chatId);
          return (
            r.chatId === store.state.selectedChatId &&
            r.status === "running" &&
            chat?.waiting &&
            chat.status === "open" &&
            chat.topicId === r.topicId &&
            store.character(r.characterId).enabled
          );
        })
        .map((r) => r.characterId),
    ),
  ];
  if (store.state.selectedChatId) {
    const chat = store.state.chats.find(
      (c) => c.id === store.state.selectedChatId,
    );
    if (chat?.waiting && chat.status === "open") {
      for (const pid of chat.participantIds) {
        if (
          store.character(pid).enabled &&
          bridge?.getTyping(chat.id, pid) &&
          !typingPids.includes(pid)
        ) {
          typingPids.push(pid);
        }
      }
    }
  }
  return {
    ...structuredClone(store.state),
    dataPath: store.root,
    vaultAvailable: vault.status,
    bridgePort: bridge?.port || 0,
    typingPids,
    presences: store.state.selectedChatId
      ? Object.fromEntries(
          store
            .chat(store.state.selectedChatId)
            .participantIds.map((pid) => [
              pid,
              store.presence(store.state.selectedChatId, pid),
            ]),
        )
      : {},
    systemLocale: app.getLocale(),
    preferredLanguage: store.state.language,
  };
};
const publish = () => {
  if (window && !window.isDestroyed())
    window.webContents.send("agentalk:state", snapshot());
};
const trusted = (event) => {
  const url = event.senderFrame?.url || "";
  if (
    event.sender !== window?.webContents ||
    (devURL
      ? new URL(url).origin !== new URL(devURL).origin
      : !url.startsWith("agentalk://app/"))
  )
    throw new Error("IPC kaynağı doğrulanamadı.");
};
const handle = (name, fn) =>
  ipcMain.handle(`agentalk:${name}`, async (event, ...args) => {
    trusted(event);
    return fn(...args);
  });

async function createWindow() {
  window = new BrowserWindow({
    title: "Agentalk",
    icon:
      process.platform === "win32"
        ? path.join(base, "public", "brand", "agentalk.ico")
        : iconPath,
    width: 1440,
    height: 940,
    // 220 px sidebar + 440 px conversation preserve 320 px message bubbles.
    minWidth: 660,
    minHeight: 700,
    backgroundColor: "#f8f9f6",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 21 },
    webPreferences: {
      preload: path.join(base, "electron", "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (
      devURL
        ? new URL(url).origin !== new URL(devURL).origin
        : !url.startsWith("agentalk://app/")
    )
      event.preventDefault();
  });
  await window.loadURL(devURL || "agentalk://app/index.html");
}

app
  .whenReady()
  .then(async () => {
    protocol.handle("agentalk", (request) => {
      const url = new URL(request.url);
      const root = path.join(base, "dist");
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (url.host !== "app" || !file.startsWith(`${root}${path.sep}`))
        return new Response("Forbidden", { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    session.defaultSession.setPermissionRequestHandler((_w, _p, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    const dataRoot =
      process.env.AGENTALK_DATA_DIR ||
      path.join(app.getPath("userData"), "workspace");
    vault = new Vault(app.getPath("userData"), safeStorage);
    store = new Store(dataRoot, publish);
    protocol.handle("agentalk-media", (request) => {
      try {
        const url = new URL(request.url);
        const ids = url.pathname.split("/").filter(Boolean);
        let file, mime;
        if (url.host === "draft" && ids.length === 2)
          ({ file, mime } = store.media.draftFile(ids[0], ids[1]));
        else if (url.host === "asset" && ids.length === 2) {
          const [chatId, mediaId] = ids;
          if (
            store.chat(chatId).deleted ||
            !store.canReadMedia(chatId, "user", mediaId, true)
          )
            return new Response("Forbidden", { status: 403 });
          file = store.media.file(chatId, mediaId);
          mime = store.media.record(chatId, mediaId).mime;
        } else return new Response("Not found", { status: 404 });
        const size = fs.statSync(file).size;
        const headers = {
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": devURL
            ? new URL(devURL).origin
            : "agentalk://app",
        };
        let start = 0,
          end = size - 1,
          status = 200;
        const range = request.headers.get("range");
        if (range) {
          const match = range.match(/^bytes=(\d*)-(\d*)$/);
          if (!match || (!match[1] && !match[2]))
            return new Response(null, { status: 416 });
          if (!match[1]) start = Math.max(0, size - Number(match[2]));
          else {
            start = Number(match[1]);
            if (match[2]) end = Math.min(end, Number(match[2]));
          }
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            start >= size
          )
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${size}` },
            });
          headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
          status = 206;
        }
        headers["Content-Length"] = String(end - start + 1);
        return new Response(
          request.method === "HEAD"
            ? null
            : Readable.toWeb(fs.createReadStream(file, { start, end })),
          { status, headers },
        );
      } catch {
        return new Response("Media unavailable", { status: 404 });
      }
    });
    app.dock?.setIcon(path.join(base, "public", "brand", "icon-mac.png"));
    updateApplicationBrand();
    runtime = new Runtime(store, vault);
    bridge = new Bridge(store, vault, () => {
      runtime.tick();
      publish();
    });
    await bridge.start();

    const writableMediaChat = (chatId, topicId) => {
      const chat = store.chat(chatId);
      if (
        chat.deleted ||
        chat.status !== "open" ||
        chat.observer ||
        (topicId && topicId !== chat.topicId)
      )
        throw new Error("Önce açık sohbetin yazışmasına dön.");
      return chat;
    };
    handle("media:stage", async (chatId, topicId, name, bytes) => {
      const chat = writableMediaChat(chatId, topicId);
      return store.media.stage(chat.id, "user", chat.topicId, name, bytes);
    });
    handle("media:preview", async (id, settings) => {
      const draft = store.media.drafts.get(id);
      if (!draft || draft.owner !== "user")
        throw new Error("Medya taslağı bulunamadı.");
      writableMediaChat(draft.chatId, draft.topicId);
      return store.media.transform(id, "user", settings);
    });
    handle("media:copy-draft", async (id) => {
      const draft = store.media.drafts.get(id);
      if (!draft || draft.owner !== "user")
        throw new Error("Medya taslağı bulunamadı.");
      writableMediaChat(draft.chatId, draft.topicId);
      return store.media.copyDraft(id, "user");
    });
    handle("media:discard", (id) => store.media.discard(id, "user"));
    handle("snapshot", snapshot);
    handle("command", (name, data = {}) => {
      switch (name) {
        case "app.language":
          if (!["tr", "en", "de"].includes(data.language))
            throw new Error("Geçersiz dil.");
          store.append("preferences.language", {
            language: resolveLocale(data.language),
          });
          updateApplicationBrand();
          break;
        case "sidebar.order":
          store.reorderSidebar(data.section, data.ids);
          break;
        case "chat.clone":
          store.cloneGroup(
            data.id,
            `${store.chat(data.id).name} (${localize("Kopya")})`.slice(0, 100),
          );
          break;
        case "character.archive": {
          store.archiveCharacter(data.id, Boolean(data.value));
          if (data.value) {
            for (const run of store.state.runs.filter(
              (r) => r.characterId === data.id,
            ))
              runtime.cancelRun(run.id);
            for (const chat of store.state.chats.filter(
              (c) => c.kind === "direct" && c.participantIds.includes(data.id),
            ))
              runtime.cancel(chat.id);
          }
          break;
        }
        case "chat.create":
          store.createChat(data);
          break;
        case "chat.direct": {
          const person = store.character(data.characterId);
          if (person.deleted || person.archived)
            throw new Error("Silinmiş kişiyle sohbet açılamaz.");
          const existing = store.state.chats.find(
            (c) =>
              c.kind === "direct" &&
              c.status === "open" &&
              c.participantIds[0] === person.id,
          );
          if (existing) store.append("chat.selected", { id: existing.id });
          else
            store.createChat({
              name: person.name,
              participantIds: [person.id],
              kind: "direct",
              heartbeatSeconds: 0,
            });
          break;
        }
        case "chat.settings":
          store.updateGroup(data);
          runtime.resetHeartbeat(data.id);
          break;
        case "chat.select":
          store.chat(data.id);
          store.append("chat.selected", { id: data.id });
          break;
        case "chat.observe":
          if (store.chat(data.id).kind === "direct" && data.value)
            throw new Error(
              "Gözlem yalnızca grup sohbetlerinde kullanılabilir.",
            );
          store.append("chat.updated", {
            id: data.id,
            observer: Boolean(data.value),
          });
          break;
        case "chat.wait": {
          const chat = store.chat(data.id);
          if (chat.observer) throw new Error("Gözlem görünümü salt okunur.");
          if (chat.status !== "open")
            throw new Error("Kapalı masa devam ettirilemez; yeni masa aç.");
          store.append("chat.updated", {
            id: chat.id,
            waiting: Boolean(data.value),
          });
          if (!data.value) runtime.cancel(chat.id);
          break;
        }
        case "chat.topic": {
          const chat = store.chat(data.id);
          if (chat.observer) throw new Error("Gözlem görünümü salt okunur.");
          store.append("chat.updated", { id: chat.id, topicId: id() });
          runtime.cancel(chat.id);
          break;
        }
        case "chat.close": {
          const chat = store.chat(data.id);
          if (chat.observer) throw new Error("Gözlem görünümü salt okunur.");
          store.append("chat.updated", {
            id: chat.id,
            status: "closed",
            waiting: false,
          });
          runtime.cancel(chat.id);
          break;
        }
        case "chat.delete":
          store.deleteChat(data.id);
          runtime.cancel(data.id);
          break;
        case "character.delete":
          store.deleteCharacter(data.id);
          for (const run of store.state.runs.filter(
            (r) => r.characterId === data.id,
          ))
            runtime.cancelRun(run.id);
          break;
        case "chat.mode": {
          const chat = store.chat(data.id);
          if (chat.observer) throw new Error("Gözlem görünümü salt okunur.");
          if (!["free", "mention_only"].includes(data.mode))
            throw new Error("Geçersiz konuşma modu.");
          store.append("chat.updated", { id: chat.id, mode: data.mode });
          break;
        }
        case "chat.budget": {
          const chat = store.chat(data.id);
          if (chat.observer) throw new Error("Gözlem görünümü salt okunur.");
          const maxTurns = Number.isInteger(data.maxTurns)
            ? Math.max(0, data.maxTurns)
            : chat.maxTurns;
          const addTurns = Number.isInteger(data.addTurns) ? data.addTurns : 0;
          const resetTurns = Boolean(data.resetTurns);
          const newCount = resetTurns
            ? 0
            : Math.max(0, (chat.turnCount || 0) - addTurns);
          store.append("chat.updated", {
            id: chat.id,
            maxTurns,
            turnCount: newCount,
            waiting: true,
          });
          break;
        }
        case "chat.invite": {
          const chat = store.chat(data.chatId);
          if (
            store.character(data.characterId).deleted ||
            store.character(data.characterId).archived
          )
            throw new Error("Silinmiş kişi gruba eklenemez.");
          if (chat.kind === "direct")
            throw new Error(
              "Birebir sohbete başka kişi eklenemez; yeni grup oluştur.",
            );
          if (chat.status !== "open" || chat.observer)
            throw new Error("Önce açık masanın yazışmasına dön.");
          if (!chat.participantIds.includes(data.characterId))
            store.append("chat.updated", {
              id: chat.id,
              participantIds: [...chat.participantIds, data.characterId],
            });
          break;
        }
        case "character.create":
          store.createCharacter(data);
          break;
        case "character.update": {
          const c = store.character(data.id);
          if (c.deleted) throw new Error("Silinmiş kişi düzenlenemez.");
          store.append("character.updated", {
            id: c.id,
            name: data.name ? data.name.trim().slice(0, 60) : c.name,
            photo: profilePhoto(data.photo ?? c.photo),
            role: data.role ? data.role.trim().slice(0, 200) : c.role,
            color: /^#[a-f\d]{6}$/i.test(data.color) ? data.color : c.color,
            instructions: data.instructions
              ? data.instructions.trim()
              : c.instructions,
            model: data.model ? data.model.trim().slice(0, 200) : c.model,
            connectionId:
              data.connectionId !== undefined
                ? data.connectionId
                : c.connectionId,
            mediaSupport: validateMediaSupport(
              data.mediaSupport ?? c.mediaSupport,
            ),
            mediaOutput: validateMediaOutput(data.mediaOutput ?? c.mediaOutput),
            contextBudget: data.contextBudget
              ? Math.max(
                  4000,
                  Math.min(500000, Number(data.contextBudget) || 40000),
                )
              : c.contextBudget,
            version: (c.version || 1) + 1,
          });
          break;
        }
        case "character.clone": {
          const source = store.character(data.id);
          store.createCharacter({
            name: `${source.name} (${localize("Kopya")})`.slice(0, 60),
            role: source.role,
            instructions: source.instructions,
            color: source.color,
            photo: source.photo,
            kind: source.kind,
            connectionId: source.connectionId,
            model: source.model,
            contextBudget: source.contextBudget,
            mediaSupport: source.mediaSupport,
            mediaOutput: source.mediaOutput,
          });
          break;
        }
        case "character.enable": {
          const c = store.character(data.id);
          if (c.deleted || c.archived)
            throw new Error(
              "Arşivlenmiş veya silinmiş kişi etkinleştirilemez.",
            );
          store.append("character.updated", {
            id: c.id,
            enabled: Boolean(data.value),
          });
          if (!data.value)
            for (const active of runtime.active.values())
              if (active.characterId === c.id) active.controller.abort();
          break;
        }
        case "message.send":
          store.acceptMessage("user", data);
          break;
        case "message.delete":
          store.deleteMessage(data.chatId, data.id, "user");
          break;
        case "message.read":
          store.markRead(data.chatId, "user", data.id);
          break;
        case "connection.create": {
          const c = validateConnection(data);
          if (!c.name) throw new Error("Bağlantıya bir ad ver.");
          const key = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
          if (key.length > 4000) throw new Error("Anahtar geçersiz.");
          const connectionId = id();
          if (key) vault.set(connectionId, key);
          store.append("connection.created", {
            ...c,
            id: connectionId,
            hasKey: Boolean(key),
          });
          break;
        }
        case "connection.capacity": {
          const connection = store.state.connections.find(
            (c) => c.id === data.id,
          );
          const capacity = Number(data.concurrency);
          if (
            !connection ||
            !Number.isInteger(capacity) ||
            capacity < 1 ||
            capacity > 8
          )
            throw new Error("Bağlantı kapasitesi 1–8 aralığında olmalı.");
          store.append("connection.updated", {
            id: connection.id,
            concurrency: capacity,
          });
          runtime.tick();
          break;
        }
        case "connection.updateKey": {
          const connection = store.state.connections.find(
            (x) => x.id === data.id,
          );
          if (!connection) throw new Error("Bağlantı bulunamadı.");
          const key = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
          if (key.length > 4000) throw new Error("Anahtar geçersiz.");
          if (key) {
            vault.set(connection.id, key);
            store.append("connection.updated", {
              id: connection.id,
              hasKey: true,
              models: [],
              modelsDiscoveredAt: null,
              modelDiscoveryError: "",
            });
          } else {
            vault.delete(connection.id);
            store.append("connection.updated", {
              id: connection.id,
              hasKey: false,
              models: [],
              modelsDiscoveredAt: null,
              modelDiscoveryError: "",
            });
          }
          break;
        }
        case "connection.delete": {
          const inUse = store.state.characters.filter(
            (c) => !c.deleted && c.connectionId === data.id,
          );
          if (inUse.length > 0) {
            throw new Error(
              `Bu bağlantıyı kullanan ${inUse.length} karakter var (${inUse.map((c) => c.name).join(", ")}). Önce bu karakterlerin bağlantısını değiştir veya sil.`,
            );
          }
          vault.delete(data.id);
          store.append("connection.deleted", { id: data.id });
          break;
        }
        case "run.retry": {
          const run = store.state.runs.find((r) => r.id === data.id);
          if (!run || !["error", "cancelled"].includes(run.status))
            throw new Error("Bu çalışma tekrar denenemez.");
          const chat = store.chat(run.chatId);
          if (
            chat.observer ||
            chat.status !== "open" ||
            !chat.waiting ||
            chat.topicId !== run.topicId
          )
            throw new Error(
              "Çalışma yalnızca açık, etkin ve aynı konudaki yazışmadan başlatılabilir.",
            );
          store.append("run.updated", {
            id: run.id,
            status: "queued",
            error: "",
          });
          break;
        }
        case "run.cancel": {
          runtime.cancelRun(data.id);
          break;
        }
        default:
          throw new Error("Komut tanınmadı.");
      }
      bridge.sync();
      if (
        [
          "message.send",
          "message.delete",
          "chat.wait",
          "chat.topic",
          "chat.close",
          "chat.mode",
          "chat.settings",
          "chat.budget",
          "character.enable",
          "chat.invite",
          "character.create",
          "character.update",
          "character.clone",
          "run.retry",
        ].includes(name)
      )
        runtime.tick();
      return snapshot();
    });
    handle("models", async (connectionId) => {
      const connection = store.state.connections.find(
        (x) => x.id === connectionId,
      );
      if (!connection) throw new Error("Bağlantı bulunamadı.");
      try {
        const models = await discoverModels(
          connection,
          vault.get(connection.id),
        );
        store.append("connection.updated", {
          id: connection.id,
          models,
          modelCapabilities: connection.modelCapabilities || {},
          modelsDiscoveredAt: new Date().toISOString(),
          modelDiscoveryError: "",
        });
        return models;
      } catch (error) {
        store.append("connection.updated", {
          id: connection.id,
          modelDiscoveryError: error.message,
        });
        throw error;
      }
    });
    handle("reveal", async (chatId, characterId) => {
      const file = chatId
        ? characterId
          ? store.participantPath(chatId, characterId)
          : path.join(store.root, "chats", store.chat(chatId).id)
        : store.root;
      await shell.openPath(file);
    });
    handle("character:export", async (characterId) => {
      const c = store.character(characterId);
      const result = await dialog.showSaveDialog(window, {
        defaultPath: `${c.name.replace(/[^\p{L}\p{N}_-]/gu, "-")}.character.json`,
        filters: [
          { name: localize("Agentalk Karakter Şablonu"), extensions: ["json"] },
        ],
      });
      if (result.canceled || !result.filePath) return false;
      atomicJSON(result.filePath, {
        schemaVersion: 1,
        name: c.name,
        role: c.role,
        color: c.color,
        photo: c.photo || "",
        instructions: c.instructions,
        contextBudget: c.contextBudget,
        version: c.version || 1,
      });
      return true;
    });
    handle("character:import", async () => {
      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        filters: [
          { name: localize("Agentalk Karakter Şablonu"), extensions: ["json"] },
        ],
      });
      if (result.canceled || !result.filePaths.length) return null;
      const raw = fs.readFileSync(result.filePaths[0], "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed.name || typeof parsed.name !== "string")
        throw new Error("Geçersiz karakter şablonu dosyası.");
      return store.createCharacter({
        name: parsed.name,
        role: parsed.role || "Dengeli değerlendirici",
        color: parsed.color || "#7b8b75",
        photo: parsed.photo || "",
        instructions: parsed.instructions || "",
        kind: "folder",
        contextBudget: parsed.contextBudget || 40000,
        version: parsed.version || 1,
      });
    });
    handle("export", async (chatId) => {
      const chat = store.chat(chatId);
      const result = await dialog.showSaveDialog(window, {
        defaultPath: `${chat.name.replace(/[^\p{L}\p{N}_-]/gu, "-")}.json`,
        filters: [{ name: localize("Sohbet kaydı"), extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return false;
      writeChatExport(store, chatId, result.filePath);
      return true;
    });
    handle("runtimeNotices", async () => {
      const target = path.join(
        app.isPackaged
          ? process.resourcesPath
          : path.join(base, "node_modules", "electron", "dist"),
        "LICENSES.chromium.html",
      );
      const error = await shell.openPath(target);
      if (error) throw new Error("Electron lisans bildirimleri açılamadı.");
    });
    handle("mediaNotices", async () => {
      const target = app.isPackaged
        ? path.join(process.resourcesPath, "MediaSources")
        : path.join(base, "vendor", "media", "sources");
      const error = await shell.openPath(target);
      if (error) throw new Error("FFmpeg kaynakları açılamadı.");
    });
    handle("openUrl", async (targetUrl) => {
      if (
        typeof targetUrl === "string" &&
        (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))
      ) {
        await shell.openExternal(targetUrl);
        return true;
      }
      return false;
    });
    await createWindow();
  })
  .catch((error) => {
    dialog.showErrorBox(
      localize("Agentalk başlatılamadı"),
      localize(error.message),
    );
    app.quit();
  });

app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && store) createWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  runtime?.close();
  bridge?.close();
  store?.media.close();
});
