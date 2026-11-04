export type Character = {
  mediaSupport?: MediaSupport;
  mediaOutput?: "text" | "audio" | "image";
  photo?: string;
  archived?: boolean;
  deleted?: boolean;
  id: string;
  name: string;
  kind: "api" | "folder";
  color: string;
  role: string;
  instructions: string;
  connectionId: string;
  model: string;
  enabled: boolean;
  version?: number;
  contextBudget: number;
};
export type Connection = {
  id: string;
  name: string;
  baseUrl: string;
  kind: "local" | "network" | "cloud";
  adapter: "compatible" | "ollama" | "anthropic" | "gemini";
  concurrency: number;
  hasKey: boolean;
  models: string[];
  modelCapabilities?: Record<
    string,
    Partial<Record<"image" | "audio" | "video", boolean>>
  >;
  modelsDiscoveredAt?: string;
  modelDiscoveryError?: string;
};
export type ChatMode = "free" | "mention_only";
export type Chat = {
  photo?: string;
  deleted?: boolean;
  id: string;
  name: string;
  description: string;
  participantIds: string[];
  rules: string;
  status: "open" | "closed";
  waiting: boolean;
  observer: boolean;
  kind?: "group" | "direct";
  mode?: ChatMode;
  heartbeatSeconds?: number;
  maxParallel?: number;
  replyStyle?: "concise" | "balanced" | "detailed";
  respondToPeers?: boolean;
  memberPreferences?: Record<
    string,
    { replyStyle: "concise" | "balanced" | "detailed"; respondToPeers: boolean }
  >;

  maxTurns?: number;
  turnCount?: number;
  deliberationEnabled?: boolean;
  topicId: string;
  createdAt: string;
};
export type Message = {
  id: string;
  chatId: string;
  topicId: string;
  from: string;
  to: string[];
  attachments?: MediaAttachment[];
  replyTo: string | null;
  content: string;
  time: string;
  sequence: number;
  recipients: string[];
  deleted?: boolean;
  deliveredTimes?: Record<string, string>;
  readTimes?: Record<string, string>;
};
export type Run = {
  id: string;
  chatId: string;
  characterId: string;
  messageId: string;
  topicId: string;
  status: "queued" | "running" | "done" | "cancelled" | "error" | "skipped";
  error?: string;
  context?: { messageIds: string[]; characters: number; budget: number };
  usage?: { total_tokens?: number };
};
export type Snapshot = {
  sidebarOrder?: { people?: string[]; groups?: string[] };
  chats: Chat[];
  characters: Character[];
  connections: Connection[];
  messages: Message[];
  runs: Run[];
  selectedChatId: string;
  dataPath: string;
  vaultAvailable: boolean | null;
  bridgePort: number;
  typingPids?: string[];
  presences?: Record<
    string,
    {
      online: boolean;
      state: string;
      lastSeenAt: string | null;
      expiresAt: string | null;
    }
  >;
  systemLocale: string;
  preferredLanguage?: string;
};
export interface AgentalkAPI {
  stageMedia(
    chatId: string,
    topicId: string,
    name: string,
    bytes: ArrayBuffer,
  ): Promise<MediaDraft>;
  previewMedia(id: string, settings: MediaSettings): Promise<MediaDraft>;
  copyMediaDraft(id: string): Promise<MediaDraft>;
  discardMedia(id: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  openRuntimeNotices(): Promise<void>;
  openMediaNotices(): Promise<void>;
  command(name: string, payload?: unknown): Promise<Snapshot>;
  models(connectionId: string): Promise<string[]>;
  reveal(chatId?: string, characterId?: string): Promise<void>;
  exportChat(chatId: string): Promise<boolean>;
  exportCharacter(characterId: string): Promise<boolean>;
  importCharacter(): Promise<Character | null>;
  openUrl?(url: string): Promise<boolean>;
  onOpenSettings(listener: (tab: "general" | "about") => void): () => void;
  subscribe(listener: (state: Snapshot) => void): () => void;
}
declare global {
  interface Window {
    agentalk: AgentalkAPI;
  }
}

export type MediaSettings = {
  maxSize?: number;
  resizeMode?: "pixels" | "percent";
  scalePercent?: number;
  format?: "jpeg" | "webp" | "png" | "wav" | "opus" | "webm";
  quality?: number;
  detail?: "low" | "auto" | "high";
  start?: number;
  duration?: number;
  fps?: number;
  muted?: boolean;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
};
export type MediaAttachment = {
  id: string;
  version: string;
  name: string;
  kind: "image" | "audio" | "video" | "document";
  position?: number;
  placement?: {
    offset: number;
    beforeLine: number | null;
    afterLine: number | null;
    inline: boolean;
  };
  document?: {
    status:
      "ready" | "unsupported" | "unreadable" | "password" | "no-text" | "limit";
    pages?: number;
    characters: number;
    excerpt: string;
  };
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  file: string;
  settings: MediaSettings;
};
export type MediaDraft = MediaAttachment & {
  url: string;
  original: {
    name: string;
    kind: "image" | "audio" | "video" | "document";
    bytes: number;
    width?: number;
    height?: number;
    duration: number;
    format?: MediaSettings["format"];
    sourceFormat?: string;
    sampleRate?: number;
    channels?: number;
    fps?: number;
    hasAudio?: boolean;
  };
};
export type MediaSupport = Record<
  "image" | "audio" | "video",
  "auto" | "yes" | "no"
>;
