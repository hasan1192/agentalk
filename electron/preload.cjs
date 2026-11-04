const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("agentalk", {
  openRuntimeNotices: () => ipcRenderer.invoke("agentalk:runtimeNotices"),
  openMediaNotices: () => ipcRenderer.invoke("agentalk:mediaNotices"),
  stageMedia: (chatId, topicId, name, bytes) =>
    ipcRenderer.invoke("agentalk:media:stage", chatId, topicId, name, bytes),
  previewMedia: (id, settings) =>
    ipcRenderer.invoke("agentalk:media:preview", id, settings),
  copyMediaDraft: (id) => ipcRenderer.invoke("agentalk:media:copy-draft", id),
  discardMedia: (id) => ipcRenderer.invoke("agentalk:media:discard", id),
  snapshot: () => ipcRenderer.invoke("agentalk:snapshot"),
  command: (name, payload) =>
    ipcRenderer.invoke("agentalk:command", name, payload),
  models: (id) => ipcRenderer.invoke("agentalk:models", id),
  reveal: (chatId, characterId) =>
    ipcRenderer.invoke("agentalk:reveal", chatId, characterId),
  exportChat: (chatId) => ipcRenderer.invoke("agentalk:export", chatId),
  exportCharacter: (characterId) =>
    ipcRenderer.invoke("agentalk:character:export", characterId),
  importCharacter: () => ipcRenderer.invoke("agentalk:character:import"),
  openUrl: (url) => ipcRenderer.invoke("agentalk:openUrl", url),
  onOpenSettings: (callback) => {
    const handler = (_event, tab) => {
      if (tab === "general" || tab === "about") callback(tab);
    };
    ipcRenderer.on("agentalk:open-settings", handler);
    return () => ipcRenderer.removeListener("agentalk:open-settings", handler);
  },
  subscribe: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("agentalk:state", handler);
    return () => ipcRenderer.removeListener("agentalk:state", handler);
  },
});
