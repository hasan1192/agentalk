import MediaPreview from "./MediaPreview";
import {
  MediaOpenContext,
  MediaDetail,
  type MediaSelection,
} from "./MediaToken";
import ResizableSidebar from "./ResizableSidebar";
import ErrorNotice from "./ErrorNotice";
import ReceiptTicks from "./ReceiptTicks";
import NumberField from "./NumberField";
import MediaContent, { mediaLabel, mediaSize } from "./MediaContent";
import MediaOptions, { defaultMediaSupport } from "./MediaOptions";
import SortableSidebarList from "./SortableSidebarList";
import ProfilePhoto from "./ProfilePhoto";
import MentionComposer from "./MentionComposer";
import ComposerAttachments from "./ComposerAttachments";
import useChatDraft from "./useChatDraft";
import { t, useLocale, initializeLocale, setLocale, LANGUAGES } from "./i18n";
import legalNotices from "./legal-notices.json";
import { BRAND } from "./brand";
import {
  THEMES,
  readAppearance,
  applyAppearance,
  type ThemeId,
  type Appearance,
} from "./themes";
import SidebarSection, { DisclosurePanel } from "./SidebarSection";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Square,
  CirclePlay,
  Copy,
  Cpu,
  Download,
  Edit3,
  Eye,
  Folder,
  Globe2,
  Layers3,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Reply,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
  Link2,
  RotateCcw,
  Radio,
  Laptop,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  UserPlus,
  ExternalLink,
  Palette,
  Smartphone,
  Code2,
  Sun,
  Moon,
  EyeOff,
  Key,
  Lock,
  RefreshCw,
  Cloud,
  Server,
  Paperclip,
} from "lucide-react";
import type {
  Snapshot,
  Character,
  Connection,
  Chat,
  ChatMode,
  Message,
  MediaDraft,
  MediaSupport,
} from "./types";

const colors = [
  "#4d6e4f",
  "#966c90",
  "#6a7fa6",
  "#b08354",
  "#518389",
  "#a66767",
];

function PersonColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (value: string) => void;
}) {
  const custom = !colors.includes(color.toLowerCase());
  const rgb = [1, 3, 5].map((start) =>
    parseInt(color.slice(start, start + 2), 16),
  );
  const contrast =
    rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 155
      ? "#18201a"
      : "#ffffff";
  return (
    <div className="person-color-picker">
      <span>{t("Renk")}</span>
      <div className="color-palette" role="group" aria-label={t("Renk")}>
        {colors.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={t("Renk: {color}", { color: preset })}
            aria-pressed={preset === color.toLowerCase()}
            style={{ background: preset }}
            className={preset === color.toLowerCase() ? "active-color" : ""}
            onClick={() => onChange(preset)}
          >
            {preset === color.toLowerCase() && <Check size={12} />}
          </button>
        ))}
        <label
          className={`custom-color-swatch${custom ? " active-color" : ""}`}
          title={t("Özel renk")}
          style={custom ? { background: color, color: contrast } : undefined}
        >
          {custom ? <Check size={12} /> : <Palette size={13} />}
          <input
            type="color"
            aria-label={t("Özel renk")}
            value={color}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

const connectionLabels: Record<Connection["kind"], string> = {
  local: "Bu bilgisayar",
  network: "Ağdaki sunucu",
  cloud: "Bulut API",
};

const adapterLabels: Record<Connection["adapter"], string> = {
  compatible: "OpenAI Uyumlu API",
  ollama: "Ollama Native API",
  anthropic: "Anthropic Claude API",
  gemini: "Google Gemini REST API",
};

type ProviderPreset = {
  id: string;
  category: "cloud" | "local" | "custom";
  name: string;
  baseUrl: string;
  kind: "local" | "network" | "cloud";
  adapter: "compatible" | "ollama" | "anthropic" | "gemini";
  placeholder: string;
  portalUrl?: string;
  defaultConcurrency: number;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    category: "cloud",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    kind: "cloud",
    adapter: "compatible",
    placeholder: "sk-proj-...",
    portalUrl: "https://platform.openai.com/api-keys",
    defaultConcurrency: 4,
  },
  {
    id: "anthropic",
    category: "cloud",
    name: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    kind: "cloud",
    adapter: "anthropic",
    placeholder: "sk-ant-api03-...",
    portalUrl: "https://platform.claude.com/settings/keys",
    defaultConcurrency: 4,
  },
  {
    id: "gemini",
    category: "cloud",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    kind: "cloud",
    adapter: "gemini",
    placeholder: "AIzaSy...",
    portalUrl: "https://aistudio.google.com/apikey",
    defaultConcurrency: 4,
  },
  {
    id: "deepseek",
    category: "cloud",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    kind: "cloud",
    adapter: "compatible",
    placeholder: "sk-...",
    portalUrl: "https://platform.deepseek.com/api_keys",
    defaultConcurrency: 4,
  },
  {
    id: "groq",
    category: "cloud",
    name: "Groq Cloud",
    baseUrl: "https://api.groq.com/openai/v1",
    kind: "cloud",
    adapter: "compatible",
    placeholder: "gsk_...",
    portalUrl: "https://console.groq.com/keys",
    defaultConcurrency: 4,
  },
  {
    id: "openrouter",
    category: "cloud",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    kind: "cloud",
    adapter: "compatible",
    placeholder: "sk-or-v1-...",
    portalUrl: "https://openrouter.ai/keys",
    defaultConcurrency: 4,
  },
  {
    id: "mistral",
    category: "cloud",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    kind: "cloud",
    adapter: "compatible",
    placeholder: "...",
    portalUrl: "https://console.mistral.ai/api-keys",
    defaultConcurrency: 4,
  },
  {
    id: "ollama",
    category: "local",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    kind: "local",
    adapter: "ollama",
    placeholder: "Sunucu istiyorsa anahtar gir",
    defaultConcurrency: 1,
  },
  {
    id: "lmstudio",
    category: "local",
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    kind: "local",
    adapter: "compatible",
    placeholder: "Sunucu istiyorsa anahtar gir",
    defaultConcurrency: 1,
  },
  {
    id: "custom",
    category: "custom",
    name: "Özel API Sunucusu",
    baseUrl: "",
    kind: "cloud",
    adapter: "compatible",
    placeholder: "API anahtarınızı yapıştırın",
    defaultConcurrency: 4,
  },
];

function getProviderDetails(c: Connection) {
  const url = (c.baseUrl || "").toLowerCase();
  if (c.adapter === "anthropic" || url.includes("anthropic.com")) {
    return {
      name: t("Anthropic Claude"),
      badge: t("Claude Native"),
      chipClass: "provider-badge-anthropic",
      color: "#d97706",
    };
  }
  if (
    c.adapter === "gemini" ||
    url.includes("generativelanguage.googleapis.com")
  ) {
    return {
      name: t("Google Gemini"),
      badge: t("Gemini Native"),
      chipClass: "provider-badge-gemini",
      color: "#2563eb",
    };
  }
  if (url.includes("deepseek.com")) {
    return {
      name: "DeepSeek",
      badge: "DeepSeek",
      chipClass: "provider-badge-deepseek",
      color: "#0284c7",
    };
  }
  if (url.includes("groq.com")) {
    return {
      name: t("Groq Cloud"),
      badge: t("Groq LPU"),
      chipClass: "provider-badge-groq",
      color: "#ea580c",
    };
  }
  if (url.includes("openrouter.ai")) {
    return {
      name: "OpenRouter",
      badge: "OpenRouter",
      chipClass: "provider-badge-openrouter",
      color: "#7c3aed",
    };
  }
  if (url.includes("mistral.ai")) {
    return {
      name: t("Mistral AI"),
      badge: "Mistral",
      chipClass: "provider-badge-mistral",
      color: "#d946ef",
    };
  }
  if (url.includes("openai.com")) {
    return {
      name: "OpenAI",
      badge: "OpenAI",
      chipClass: "provider-badge-openai",
      color: "#10b981",
    };
  }
  if (c.adapter === "ollama") {
    return {
      name: "Ollama",
      badge: "Ollama",
      chipClass: "provider-badge-ollama",
      color: "#64748b",
    };
  }
  return {
    name: c.name || "API",
    badge: c.adapter === "compatible" ? t("Uyumlu API") : t("Özel"),
    chipClass: "provider-badge-custom",
    color: "#6b7280",
  };
}

function getSuggestedModelsForConnection(
  connection: Connection | undefined,
): string[] {
  return connection?.modelsDiscoveredAt ? connection.models : [];
}

function ModelDiscovery({
  connection,
}: {
  connection: Connection | undefined;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="model-discovery">
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={!connection || loading}
        onClick={async () => {
          if (!connection) return;
          setLoading(true);
          setError("");
          try {
            await window.agentalk.models(connection.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setLoading(false);
          }
        }}
      >
        <RefreshCw size={13} className={loading ? "spinning" : ""} />
        {loading ? t("Modeller yükleniyor…") : t("Modelleri yenile")}
      </button>
      <small key={connection?.id}>
        {connection?.modelsDiscoveredAt
          ? t("{v0} model · Son keşif: {v1}", {
              v0: connection.models.length,
              v1: new Date(connection.modelsDiscoveredAt).toLocaleString(
                document.documentElement.lang,
              ),
            })
          : t(
              "Model listesini bağlantıdan getir veya tam model kimliğini elle gir.",
            )}
      </small>
      {error && (
        <div role="alert">
          <ErrorNotice message={error} />
        </div>
      )}
    </div>
  );
}

function Avatar({
  name,
  color = "#4d6e4f",
  size = "",
  user = false,
  photo,
}: {
  photo?: string;
  name: string;
  color?: string;
  size?: string;
  user?: boolean;
}) {
  return (
    <span
      className={`avatar ${size} ${user ? "user-avatar" : ""}`}
      style={{ "--avatar-color": color } as React.CSSProperties}
      aria-hidden="true"
    >
      {photo ? (
        <img src={photo} alt="" />
      ) : user ? (
        <User size={size === "tiny" ? 11 : size === "small" ? 13 : 15} />
      ) : (
        name.slice(0, 1).toLocaleUpperCase(document.documentElement.lang)
      )}
    </span>
  );
}

function IconButton({
  title,
  children,
  onClick,
  active = false,
  disabled = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
  maxWidth = "520px",
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  maxWidth?: string;
  className?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    element.current?.querySelector<HTMLInputElement>("input, button")?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const focusable = [
          ...(element.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
          ) ?? []),
        ];
        if (event.shiftKey && document.activeElement === focusable[0]) {
          event.preventDefault();
          focusable.at(-1)?.focus();
        }
        if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
          event.preventDefault();
          focusable[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={element}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${className}`}
        style={{ maxWidth }}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton title={t("Kapat")} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  useLocale();
  const [state, setState] = useState<Snapshot | null>(null);
  const [theme, setTheme] = useState<ThemeId>(() => readAppearance().theme);
  const [appearance, setAppearance] = useState<Appearance>(
    () => readAppearance().appearance,
  );
  const [modal, setModal] = useState<
    | "chat"
    | "group-settings"
    | "add-ai"
    | "connection"
    | "character"
    | "settings"
    | null
  >(null);
  const [personConnectionModal, setPersonConnectionModal] = useState(false);
  const [newCharModel, setNewCharModel] = useState("");
  const [settingsTab, setSettingsTab] = useState<
    "general" | "connections" | "about"
  >("general");
  const [settingsRevision, setSettingsRevision] = useState(0);
  useEffect(
    () =>
      window.agentalk?.onOpenSettings((tab) => {
        setSettingsTab(tab);
        setSettingsRevision((revision) => revision + 1);
        setModal("settings");
      }),
    [],
  );
  const [activeDrawer, setActiveDrawer] = useState<"participants" | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [peopleCollapsed, setPeopleCollapsed] = useState(false);
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    person?: Character;
    group?: Chat;
  } | null>(null);
  const [settingsChat, setSettingsChat] = useState<Chat | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!contextMenu) return;
    contextMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (e: MouseEvent) => {
      if (!contextMenuRef.current?.contains(e.target as Node))
        setContextMenu(null);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = [
          ...(contextMenuRef.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) || []),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        buttons[
          (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      }
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", keyboard);
    const resize = () => setContextMenu(null);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", keyboard);
    };
  }, [contextMenu]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const chat = state?.chats.find((c) => c.id === state.selectedChatId);
  const {
    draft,
    setDraft,
    pendingMedia,
    setPendingMedia,
    pendingMediaRef,
    retainedMedia,
    composerRevision,
    setComposerRevision,
    targetIds,
    setTargetIds,
    replyTarget,
    setReplyTarget,
    insertionPosition,
    composerMemory,
    resetEditorMemory,
  } = useChatDraft(chat, state?.chats);
  const draftScope = chat ? `${chat.id}:${chat.topicId}` : "";
  const [mediaView, setMediaView] = useState<
    (MediaSelection & { scope: string }) | null
  >(null);
  const openedMedia = mediaView?.scope === draftScope ? mediaView : null;
  const setOpenedMedia = (value: MediaSelection | null) =>
    setMediaView(value ? { ...value, scope: draftScope } : null);
  const [mediaImport, setMediaImport] = useState<{
    scope: string;
    files: File[];
  } | null>(null);
  const mediaFiles =
    mediaImport?.scope === draftScope ? mediaImport.files : null;
  const setMediaFiles = (files: File[] | null) =>
    setMediaImport(files ? { scope: draftScope, files } : null);
  const [dragMedia, setDragMedia] = useState(false);
  const mediaInput = useRef<HTMLInputElement>(null);
  const mediaInsertion = useRef(0);
  const dragMediaDepth = useRef(0);
  const [searchMessageId, setSearchMessageId] = useState("");
  const [perspective, setPerspective] = useState("all");
  const [menu, setMenu] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(
    null,
  );
  const [newCharConnectionId, setNewCharConnectionId] = useState<
    string | undefined
  >(undefined);

  useEffect(() => {
    applyAppearance(theme, appearance);
  }, [theme, appearance]);

  const end = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [atEnd, setAtEnd] = useState(true);

  useEffect(() => {
    if (!window.agentalk) {
      setError(
        t(
          "Bu ekran Electron üzerinden açılmalı. Proje klasöründe npm run dev çalıştır.",
        ),
      );
      return;
    }
    window.agentalk
      .snapshot()
      .then((snapshot) => {
        initializeLocale(snapshot.preferredLanguage || snapshot.systemLocale);
        setState(snapshot);
      })
      .catch((e) => setError(e.message));
    return window.agentalk.subscribe(setState);
  }, []);

  const isGroup = chat && chat.kind !== "direct";
  useEffect(() => {
    setOpenedMedia(null);
    setMediaFiles(null);
    setDragMedia(false);
    dragMediaDepth.current = 0;
  }, [chat?.id, chat?.topicId, chat?.observer, chat?.status]);
  const addFiles = (files: File[]) => {
    if (!chat || chat.observer || chat.status !== "open" || mediaFiles) return;
    if (files.length + pendingMedia.length > 6) {
      setError(t("Bir mesajda en fazla 6 medya eki olabilir."));
      return;
    }
    if (files.length) {
      mediaInsertion.current = Math.min(
        insertionPosition.current,
        draft.length,
      );
      setMediaFiles(files);
    }
  };
  const removePending = (id: string) => {
    pendingMediaRef.current = pendingMediaRef.current.filter(
      (media) => media.id !== id,
    );
    setPendingMedia(pendingMediaRef.current);
  };
  const movePending = (positions: { id: string; position: number }[]) => {
    const byId = retainedMedia.current;
    pendingMediaRef.current = positions.flatMap((p) => {
      const m = byId.get(p.id);
      return m ? [{ ...m, position: p.position }] : [];
    });
    setPendingMedia(pendingMediaRef.current);
  };
  const participants =
    state?.characters.filter(
      (c) => !c.deleted && chat?.participantIds.includes(c.id),
    ) ?? [];

  const messages =
    state?.messages.filter(
      (m) =>
        m.chatId === chat?.id &&
        (chat?.observer
          ? perspective === "all" ||
            m.from === perspective ||
            m.recipients.includes(perspective)
          : m.from === "user" || m.recipients.includes("user")),
    ) ?? [];

  const runs = state?.runs.filter((r) => r.chatId === chat?.id) ?? [];
  const unreadOnly = Boolean(chat?.observer);
  const ordered = <T extends { id: string }>(
    items: T[],
    order: string[] = [],
  ) =>
    [...items].sort((a, b) => {
      const ai = order.indexOf(a.id),
        bi = order.indexOf(b.id);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    });
  const people = ordered(
    state?.characters.filter((c) => !c.deleted && !c.archived) ?? [],
    state?.sidebarOrder?.people,
  );
  const archivedPeople = ordered(
    state?.characters.filter((c) => !c.deleted && c.archived) ?? [],
    state?.sidebarOrder?.people,
  );
  useEffect(() => {
    if (!searchMessageId || !messages.some((m) => m.id === searchMessageId))
      return;
    requestAnimationFrame(() =>
      document
        .getElementById(`message-${searchMessageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }, [chat?.id, searchMessageId, messages.length]);
  const typingPeople = participants.filter(
    (c) => state?.typingPids?.includes(c.id) && !c.deleted,
  );
  const openContextMenu = (
    event: React.MouseEvent | React.KeyboardEvent,
    item: { person?: Character; group?: Chat },
  ) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = "clientX" in event ? event.clientX : rect.right;
    const y = "clientY" in event ? event.clientY : rect.top;
    setContextMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 240)),
      y: Math.max(8, Math.min(y, window.innerHeight - 300)),
      ...item,
    });
  };

  const isReplyVisible = (msg: Message) => {
    if (chat?.observer) {
      if (perspective === "all") return true;
      return msg.from === perspective || msg.recipients.includes(perspective);
    }
    return msg.from === "user" || msg.recipients.includes("user");
  };

  useEffect(() => {
    setPerspective("all");
    setMenu(false);
    setActiveDrawer(null);
  }, [chat?.id]);

  useEffect(() => {
    if (!chat || chat.observer || document.visibilityState !== "visible")
      return;
    for (const m of messages) {
      if (m.from !== "user" && (!m.readTimes || !m.readTimes["user"])) {
        window.agentalk
          ?.command("message.read", {
            chatId: chat.id,
            participantId: "user",
            id: m.id,
          })
          .catch(() => {});
      }
    }
  }, [state?.messages, chat?.id, chat?.observer]);

  useEffect(() => {
    if (atEnd && messages.length)
      end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typingPeople.length, atEnd, chat?.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInput.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setModal("chat");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const act = async (command: string, data?: unknown) => {
    setBusy(true);
    setError("");
    try {
      setState(await window.agentalk.command(command, data));
      return true;
    } catch (e) {
      setError(
        (e as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (
      !chat ||
      (!draft.trim() && !pendingMedia.length) ||
      busy ||
      unreadOnly ||
      chat.status !== "open" ||
      mediaFiles ||
      openedMedia
    )
      return;
    const replyTo = replyTarget ? replyTarget.id : null;
    if (
      await act("message.send", {
        chatId: chat.id,
        id: crypto.randomUUID(),
        content: draft,
        attachments: pendingMedia.map((m) => ({
          id: m.id,
          version: m.version,
          position: m.position ?? draft.length,
        })),
        to:
          chat.kind === "direct"
            ? [chat.participantIds[0]]
            : targetIds.length
              ? targetIds
              : ["all"],
        replyTo,
        topicId: chat.topicId,
      })
    ) {
      setDraft("");
      setPendingMedia([]);
      pendingMediaRef.current = [];
      for (const media of retainedMedia.current.values())
        void window.agentalk.discardMedia(media.id);
      retainedMedia.current.clear();
      resetEditorMemory();
      setComposerRevision((value) => value + 1);
      setReplyTarget(null);
      setAtEnd(true);
    }
  };

  const nameOf = (pid: string) =>
    pid === "user"
      ? t("Sen")
      : pid === "all"
        ? t("Herkes")
        : state?.characters.find((c) => c.id === pid)?.name || pid;

  const normalizeSearch = (value: string) =>
    value.toLocaleLowerCase(document.documentElement.lang);
  const query = normalizeSearch(search.trim());
  // Match exactly the same owner-visible scope as normal conversation view.
  const searchableMessages =
    state?.messages.filter(
      (m) =>
        !m.deleted &&
        (m.from === "user" || m.recipients.includes("user")) &&
        state.chats.some((c) => c.id === m.chatId && !c.deleted),
    ) ?? [];
  const messageResults = query
    ? searchableMessages.filter((m) =>
        normalizeSearch(m.content).includes(query),
      )
    : [];
  const lastMessage = (chatIds: string[]) =>
    searchableMessages.filter((m) => chatIds.includes(m.chatId)).at(-1);
  const personChatIds = (id: string) =>
    state?.chats
      .filter(
        (c) =>
          !c.deleted && c.kind === "direct" && c.participantIds.includes(id),
      )
      .map((c) => c.id) ?? [];
  const preview = (m?: Message) =>
    m
      ? `${nameOf(m.from)}: ${(m.content || (m.attachments || []).map((a) => mediaLabel(a.kind)).join(", ")).replace(/\s+/g, " ")}`
      : t("Henüz mesaj yok");
  const personMatches = (c: Character) =>
    !query ||
    normalizeSearch(`${c.name} ${c.role}`).includes(query) ||
    messageResults.some((m) => personChatIds(c.id).includes(m.chatId));
  const groupMatches = (c: Chat) =>
    !query ||
    normalizeSearch(c.name).includes(query) ||
    messageResults.some((m) => m.chatId === c.id);
  const openInfo = () => {
    if (!chat) return;
    if (chat.kind === "direct")
      setEditingCharacter(
        state?.characters.find((c) => c.id === chat.participantIds[0]) ?? null,
      );
    else {
      setSettingsChat(chat);
      setModal("group-settings");
    }
  };
  const persistOrder = async (
    section: "people" | "groups",
    visibleIds: string[],
  ) => {
    if (!state) return;
    const all =
      section === "people"
        ? ordered(
            state.characters.filter((c) => !c.deleted),
            state.sidebarOrder?.people,
          )
        : ordered(
            state.chats.filter((c) => !c.deleted && c.kind !== "direct"),
            state.sidebarOrder?.groups,
          );
    // Keep filtered and archived entries in their existing slots.
    const visible = new Set(visibleIds);
    let index = 0;
    const ids = all.map((item) =>
      visible.has(item.id) ? visibleIds[index++] : item.id,
    );
    await act("sidebar.order", { section, ids });
  };

  if (!state)
    return (
      <div className="loading">
        <img className="brand-mark" src={BRAND.icon} alt="" />
        <h2>{BRAND.name}</h2>
        <p>{error || t("Çalışma alanın hazırlanıyor…")}</p>
      </div>
    );

  const activeChats = ordered(
    state.chats.filter(
      (c) =>
        !c.deleted &&
        c.status === "open" &&
        c.kind !== "direct" &&
        groupMatches(c),
    ),
    state.sidebarOrder?.groups,
  );
  const archivedChats = ordered(
    state.chats.filter(
      (c) =>
        !c.deleted &&
        c.status === "closed" &&
        c.kind !== "direct" &&
        groupMatches(c),
    ),
    state.sidebarOrder?.groups,
  );

  return (
    <div className="app-shell">
      {/* 1. SOL BÖLÜM (Sidebar) */}
      <ResizableSidebar collapsed={sidebarCollapsed}>
        <div className="sidebar-drag" />

        <div className="sidebar-header">
          {!sidebarCollapsed ? (
            <>
              <div className="brand">
                <img className="brand-mark" src={BRAND.icon} alt="" />
                <span className="brand-text">{BRAND.wordmark}</span>
              </div>
              <IconButton
                title={t("Kenar çubuğunu daralt (⌘B)")}
                onClick={() => setSidebarCollapsed(true)}
                className="collapse-toggle"
                aria-label={t("Kenar çubuğunu daralt")}
              >
                <PanelLeftClose size={16} />
              </IconButton>
            </>
          ) : (
            <div className="collapsed-header-wrap">
              <button
                type="button"
                className="collapsed-toggle-btn"
                onClick={() => setSidebarCollapsed(false)}
                title={t("Kenar çubuğunu aç (⌘B)")}
                aria-label={t("Kenar çubuğunu aç")}
              >
                <PanelLeftOpen size={18} />
              </button>
            </div>
          )}
        </div>

        {!sidebarCollapsed ? (
          <div className="search-wrap">
            <Search size={14} className="search-icon" />
            <input
              ref={searchInput}
              aria-label={t("Kişi, grup veya mesaj ara")}
              placeholder={t("Kişi, grup veya mesaj ara")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="clear-search"
                onClick={() => setSearch("")}
                title={t("Aramayı temizle")}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ) : (
          <div className="collapsed-search-wrap">
            <button
              type="button"
              className="collapsed-icon-btn"
              onClick={() => {
                setSidebarCollapsed(false);
                setTimeout(() => searchInput.current?.focus(), 80);
              }}
              title={t("Sohbetlerde ara (⌘K)")}
              aria-label={t("Kişi, grup veya mesaj ara")}
            >
              <Search size={16} />
            </button>
          </div>
        )}

        <div className="chat-nav">
          {query && !sidebarCollapsed && (
            <div className="message-search-results">
              <h3>
                {t("Mesajlar ({count})", { count: messageResults.length })}
              </h3>
              {messageResults
                .slice()
                .reverse()
                .slice(0, 50)
                .map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={async () => {
                      setSearchMessageId(m.id);
                      setAtEnd(false);
                      if (chat?.id !== m.chatId)
                        await act("chat.select", { id: m.chatId });
                    }}
                  >
                    <strong>
                      {state.chats.find((c) => c.id === m.chatId)?.kind ===
                      "direct"
                        ? nameOf(
                            state.chats.find((c) => c.id === m.chatId)!
                              .participantIds[0],
                          )
                        : state.chats.find((c) => c.id === m.chatId)?.name}
                    </strong>
                    <small>{nameOf(m.from)}</small>
                    <span>{m.content}</span>
                  </button>
                ))}
              {messageResults.length > 50 && (
                <small>{t("İlk 50 sonuç gösteriliyor. Aramanı daralt.")}</small>
              )}
            </div>
          )}
          <SidebarSection
            id="sidebar-people"
            className="people-section"
            label={t("Kişiler")}
            count={people.length}
            expanded={!peopleCollapsed}
            compact={sidebarCollapsed}
            toggleLabel={
              peopleCollapsed ? t("Kişileri genişlet") : t("Kişileri daralt")
            }
            addLabel={t("Kişi ekle")}
            onToggle={() => setPeopleCollapsed(!peopleCollapsed)}
            onAdd={() => {
              setNewCharConnectionId(undefined);
              setNewCharModel("");
              setModal("character");
            }}
          >
            <SortableSidebarList
              items={people.filter(personMatches)}
              onReorder={(ids) => persistOrder("people", ids)}
              renderItem={(c) => {
                const selected =
                  chat?.kind === "direct" && chat.participantIds[0] === c.id;
                return (
                  <div
                    key={c.id}
                    className={`person-nav-row ${selected ? "selected" : ""}`}
                  >
                    <button
                      className="person-chat-button"
                      onContextMenu={(e) => openContextMenu(e, { person: c })}
                      onKeyDown={(e) => {
                        if (
                          e.key === "ContextMenu" ||
                          (e.shiftKey && e.key === "F10")
                        )
                          openContextMenu(e, { person: c });
                      }}
                      title={t("{v0} ile sohbet", { v0: c.name })}
                      aria-label={t("{v0} ile sohbet", { v0: c.name })}
                      onClick={() => act("chat.direct", { characterId: c.id })}
                    >
                      <Avatar
                        photo={c.photo}
                        name={c.name}
                        color={c.color}
                        size="small"
                      />
                      {!sidebarCollapsed && (
                        <span className="nav-copy">
                          <span className="person-name-line">
                            <strong>{c.name}</strong>
                            <small title={c.role}>{c.role}</small>
                          </span>
                          <span
                            className="last-message"
                            title={preview(lastMessage(personChatIds(c.id)))}
                          >
                            {preview(lastMessage(personChatIds(c.id)))}
                          </span>
                        </span>
                      )}
                    </button>
                  </div>
                );
              }}
            />
            {!sidebarCollapsed && !people.length && (
              <p className="sidebar-empty-note">
                {t("Önce bir kişi ekle. Sonra onunla konuş veya bir grup kur.")}
              </p>
            )}
            {archivedPeople.length > 0 && (
              <details className="person-archive">
                <summary>
                  {sidebarCollapsed ? (
                    <Folder size={14} />
                  ) : (
                    t("Arşivlenmiş kişiler ({count})", {
                      count: archivedPeople.length,
                    })
                  )}
                </summary>
                <SortableSidebarList
                  items={archivedPeople.filter(personMatches)}
                  onReorder={(ids) => persistOrder("people", ids)}
                  renderItem={(c) => (
                    <button
                      type="button"
                      key={c.id}
                      className="person-chat-button archived"
                      onContextMenu={(e) => openContextMenu(e, { person: c })}
                      onClick={() => setEditingCharacter(c)}
                    >
                      <Avatar
                        photo={c.photo}
                        name={c.name}
                        color={c.color}
                        size="small"
                      />
                      {!sidebarCollapsed && (
                        <span className="nav-copy">
                          <span className="person-name-line">
                            <strong>{c.name}</strong>
                            <small title={c.role}>{c.role}</small>
                          </span>
                          <span className="last-message">
                            {preview(lastMessage(personChatIds(c.id)))}
                          </span>
                        </span>
                      )}
                    </button>
                  )}
                />
              </details>
            )}
            {!sidebarCollapsed && (
              <button
                className="sidebar-import"
                onClick={() => attempt(() => window.agentalk.importCharacter())}
              >
                <Download size={12} />
                {t("Kişi şablonu aktar")}
              </button>
            )}
          </SidebarSection>
          <SidebarSection
            id="sidebar-groups"
            label={t("Gruplar")}
            count={activeChats.length}
            expanded={!groupsCollapsed}
            compact={sidebarCollapsed}
            toggleLabel={
              groupsCollapsed ? t("Grupları genişlet") : t("Grupları daralt")
            }
            addLabel={t("Yeni grup")}
            onToggle={() => setGroupsCollapsed(!groupsCollapsed)}
            onAdd={() => setModal("chat")}
          >
            <div className="chat-list" role="list">
              <SortableSidebarList
                items={activeChats}
                onReorder={(ids) => persistOrder("groups", ids)}
                renderItem={(c) => {
                  const isSelected = chat?.id === c.id;
                  const chatParticipants = state.characters.filter((p) =>
                    c.participantIds.includes(p.id),
                  );
                  if (sidebarCollapsed) {
                    return (
                      <button
                        key={c.id}
                        onContextMenu={(e) => openContextMenu(e, { group: c })}
                        onKeyDown={(e) => {
                          if (
                            e.key === "ContextMenu" ||
                            (e.shiftKey && e.key === "F10")
                          )
                            openContextMenu(e, { group: c });
                        }}
                        className={`collapsed-chat-item ${isSelected ? "selected" : ""}`}
                        onClick={() => act("chat.select", { id: c.id })}
                        title={t("{v0} ({v1} AI)", {
                          v0: c.name,
                          v1: chatParticipants.length,
                        })}
                        aria-label={c.name}
                      >
                        <Avatar photo={c.photo} name={c.name} size="small" />
                        {c.waiting && (
                          <span className="collapsed-status-dot online" />
                        )}
                      </button>
                    );
                  }
                  return (
                    <button
                      key={c.id}
                      onContextMenu={(e) => openContextMenu(e, { group: c })}
                      onKeyDown={(e) => {
                        if (
                          e.key === "ContextMenu" ||
                          (e.shiftKey && e.key === "F10")
                        )
                          openContextMenu(e, { group: c });
                      }}
                      className={`chat-item ${isSelected ? "selected" : ""}`}
                      onClick={() => act("chat.select", { id: c.id })}
                    >
                      <Avatar photo={c.photo} name={c.name} size="small" />
                      <div className="chat-item-main">
                        <span className="chat-name">{c.name}</span>
                        <span
                          className="last-message"
                          title={preview(lastMessage([c.id]))}
                        >
                          {preview(lastMessage([c.id]))}
                        </span>
                      </div>
                      {c.waiting && <span className="status-dot online" />}
                    </button>
                  );
                }}
              />
              {activeChats.length === 0 && (
                <div className="no-chats-msg">
                  {!sidebarCollapsed
                    ? search
                      ? t("Eşleşen sohbet yok.")
                      : t("Açık sohbet yok.")
                    : "—"}
                </div>
              )}
            </div>

            {archivedChats.length > 0 && (
              <div className="archived-section">
                {!sidebarCollapsed ? (
                  <>
                    <button
                      className="archived-toggle"
                      onClick={() => setShowArchived(!showArchived)}
                      aria-expanded={showArchived}
                      aria-controls="sidebar-archive"
                    >
                      <ChevronRight
                        size={14}
                        className={`accordion-arrow ${showArchived ? "expanded" : ""}`}
                      />
                      <span>
                        {t("Arşivlenmiş (")}
                        {archivedChats.length})
                      </span>
                    </button>
                    <DisclosurePanel
                      id="sidebar-archive"
                      expanded={showArchived}
                    >
                      <div className="archived-list">
                        <SortableSidebarList
                          items={archivedChats}
                          onReorder={(ids) => persistOrder("groups", ids)}
                          renderItem={(c) => (
                            <button
                              key={c.id}
                              onContextMenu={(e) =>
                                openContextMenu(e, { group: c })
                              }
                              onKeyDown={(e) => {
                                if (
                                  e.key === "ContextMenu" ||
                                  (e.shiftKey && e.key === "F10")
                                )
                                  openContextMenu(e, { group: c });
                              }}
                              className={`chat-item archived ${chat?.id === c.id ? "selected" : ""}`}
                              onClick={() => act("chat.select", { id: c.id })}
                            >
                              <Avatar
                                photo={c.photo}
                                name={c.name}
                                size="small"
                              />
                              <span className="chat-item-main">
                                <span className="chat-name">{c.name}</span>
                                <span className="last-message">
                                  {preview(lastMessage([c.id]))}
                                </span>
                              </span>
                              <span className="archived-badge">
                                {t("Arşiv")}
                              </span>
                            </button>
                          )}
                        />
                      </div>
                    </DisclosurePanel>
                  </>
                ) : (
                  <button
                    type="button"
                    className="collapsed-icon-btn"
                    onClick={() => {
                      setSidebarCollapsed(false);
                      setShowArchived(true);
                    }}
                    title={t("Arşivlenmiş sohbetler ({v0})", {
                      v0: archivedChats.length,
                    })}
                    aria-label={t("Arşivlenmiş sohbetler")}
                  >
                    <Folder size={16} />
                  </button>
                )}
              </div>
            )}
          </SidebarSection>
        </div>

        <div className="sidebar-footer">
          <button
            className="settings-trigger"
            onClick={() => {
              setSettingsTab("general");
              setModal("settings");
            }}
            title={t("Uygulama ayarları ve API bağlantıları")}
            aria-label={t("Ayarlar")}
          >
            <Settings size={16} />
            {!sidebarCollapsed && <span>{t("Ayarlar")}</span>}
          </button>
          <button
            type="button"
            className="appearance-toggle"
            aria-label={
              appearance === "dark"
                ? t("Aydınlık görünüme geç")
                : t("Karanlık görünüme geç")
            }
            title={
              appearance === "dark"
                ? t("Aydınlık görünüme geç")
                : t("Karanlık görünüme geç")
            }
            onClick={() =>
              setAppearance(appearance === "dark" ? "light" : "dark")
            }
          >
            {appearance === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </ResizableSidebar>

      {/* 2. AKTİF SOHBET ALANI */}
      <main
        className="main-content"
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            addFiles(Array.from(e.clipboardData.files));
          }
        }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          if (chat && !chat.observer && chat.status === "open" && !mediaFiles) {
            dragMediaDepth.current++;
            setDragMedia(true);
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect =
              chat && !chat.observer && chat.status === "open"
                ? "copy"
                : "none";
          }
        }}
        onDragLeave={(e) => {
          if (
            e.dataTransfer.types.includes("Files") &&
            --dragMediaDepth.current <= 0
          ) {
            dragMediaDepth.current = 0;
            setDragMedia(false);
          }
        }}
        onDrop={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            dragMediaDepth.current = 0;
            setDragMedia(false);
            addFiles(Array.from(e.dataTransfer.files));
          }
        }}
      >
        {dragMedia && (
          <div className="chat-media-drop-overlay">
            <Paperclip size={34} />
            <strong>{t("Medyayı buraya bırak")}</strong>
            <span>{t("Göndermeden önce önizleyip düzenleyebilirsin.")}</span>
          </div>
        )}
        {chat ? (
          <>
            {/* Sohbet Üst Alanı */}
            <header className="chat-header">
              <div className="chat-header-info-wrap">
                {sidebarCollapsed && (
                  <button
                    type="button"
                    className="chat-header-expand-btn"
                    onClick={() => setSidebarCollapsed(false)}
                    title={t("Kenar çubuğunu aç (⌘B)")}
                    aria-label={t("Kenar çubuğunu aç")}
                  >
                    <PanelLeftOpen size={17} />
                  </button>
                )}
                <div className="chat-header-info">
                  <button
                    type="button"
                    className="chat-info-trigger"
                    aria-label={
                      isGroup ? t("Grup bilgileri") : t("Kişi bilgileri")
                    }
                    onClick={openInfo}
                  >
                    <Avatar
                      photo={isGroup ? chat.photo : participants[0]?.photo}
                      name={
                        isGroup ? chat.name : participants[0]?.name || chat.name
                      }
                      color={participants[0]?.color}
                      size="small"
                    />
                    <h1 className="chat-title">
                      {isGroup ? chat.name : participants[0]?.name || chat.name}
                    </h1>
                    {!isGroup && participants[0]?.role && (
                      <span
                        className="header-role"
                        title={participants[0].role}
                      >
                        {participants[0].role}
                      </span>
                    )}
                  </button>
                  {chat.description && (
                    <p className="chat-subtitle">{chat.description}</p>
                  )}
                  {isGroup && (
                    <div className="group-chat-controls">
                      <button
                        type="button"
                        className={`group-members-link ${activeDrawer === "participants" ? "active" : ""}`}
                        aria-label={t("Katılımcılar")}
                        aria-expanded={activeDrawer === "participants"}
                        onClick={() =>
                          setActiveDrawer(
                            activeDrawer === "participants"
                              ? null
                              : "participants",
                          )
                        }
                      >
                        <Users size={12} />
                        <span>
                          {t("{count} katılımcı", {
                            count: participants.length + 1,
                          })}
                        </span>
                        <ChevronDown size={11} />
                      </button>
                      <span
                        className="group-control-divider"
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        className={`group-observer-link ${chat.observer ? "active" : ""}`}
                        onClick={() =>
                          act("chat.observe", {
                            id: chat.id,
                            value: !chat.observer,
                          })
                        }
                        aria-label={
                          chat.observer
                            ? t("Gözlem modunu kapat")
                            : t("Gözlem modunu aç")
                        }
                        aria-pressed={chat.observer}
                        title={t("Grubun tüm akışını salt okunur görüntüle")}
                      >
                        <Eye size={12} />
                        <span>{t("Gözlem")}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="chat-header-actions">
                {/* Duraklatıldı Durumu */}
                {!chat.waiting && chat.status === "open" && (
                  <span className="paused-badge">{t("Durduruldu")}</span>
                )}

                {/* ⋯ Masa Seçenekleri */}
                <div className="menu-container">
                  <IconButton
                    title={t("Masa seçenekleri")}
                    active={menu}
                    onClick={() => setMenu(!menu)}
                  >
                    <MoreHorizontal size={18} />
                  </IconButton>

                  {menu && (
                    <div className="dropdown-menu">
                      <button
                        onClick={() => {
                          openInfo();
                          setMenu(false);
                        }}
                      >
                        <Settings size={15} />
                        <span>
                          {isGroup ? t("Grup bilgileri") : t("Kişi bilgileri")}
                        </span>
                      </button>
                      {isGroup && (
                        <button
                          disabled={chat.observer || chat.status !== "open"}
                          onClick={() => {
                            setModal("add-ai");
                            setMenu(false);
                          }}
                        >
                          <UserPlus size={15} />
                          <span>{t("Gruba kişi ekle")}</span>
                        </button>
                      )}

                      <button
                        disabled={chat.observer || chat.status === "closed"}
                        onClick={() => {
                          act("chat.wait", {
                            id: chat.id,
                            value: !chat.waiting,
                          });
                          setMenu(false);
                        }}
                      >
                        {chat.waiting ? (
                          <Square size={15} />
                        ) : (
                          <CirclePlay size={15} />
                        )}
                        <span>
                          {chat.waiting
                            ? t("Aktif konuşmayı durdur")
                            : t("Yeni mesajları yanıtla")}
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          attempt(() => window.agentalk.reveal(chat.id));
                          setMenu(false);
                        }}
                      >
                        <Folder size={15} />
                        <span>{t("Masa klasörünü aç")}</span>
                      </button>

                      <button
                        onClick={() => {
                          attempt(() => window.agentalk.exportChat(chat.id));
                          setMenu(false);
                        }}
                      >
                        <Download size={15} />
                        <span>{t("Sohbeti dışa aktar")}</span>
                      </button>

                      <div className="dropdown-divider" />

                      <button
                        className="danger"
                        disabled={chat.observer || chat.status === "closed"}
                        onClick={() => {
                          act("chat.close", { id: chat.id });
                          setMenu(false);
                        }}
                      >
                        <X size={15} />
                        <span>{t("Masayı kapat ve arşivle")}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </header>

            {/* Sohbet Gövdesi ve Çekmeceler */}
            <div className="chat-body">
              <MediaOpenContext.Provider value={setOpenedMedia}>
                <section className="conversation-panel">
                  {/* Gözlem Modu Bilgilendirme Bandı */}
                  {chat.observer && (
                    <div className="observer-banner">
                      <div className="observer-banner-text">
                        <Eye size={16} />
                        <span>
                          {t(
                            "Gözlem görünümü salt okunur. Mesaj teslimi yapmaz veya AI’yi uyandırmaz.",
                          )}
                        </span>
                      </div>
                      <div className="observer-banner-controls">
                        <label
                          htmlFor="perspective-select"
                          className="perspective-label"
                        >
                          {t("Görünüm:")}
                        </label>
                        <select
                          id="perspective-select"
                          aria-label={t("Katılımcı bağlamı")}
                          value={perspective}
                          onChange={(e) => setPerspective(e.target.value)}
                          className="perspective-select"
                        >
                          <option value="all">{t("Tüm konuşma")}</option>
                          <option value="user">{t("Senin mesajların")}</option>
                          {participants.map((c) => (
                            <option key={c.id} value={c.id}>
                              {t("{name} bağlamı", { name: c.name })}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-exit-observer"
                          onClick={() =>
                            act("chat.observe", { id: chat.id, value: false })
                          }
                        >
                          {t("Yazışmaya dön")}
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Mesaj Akışı */}
                  <div
                    className="message-scroll"
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      setAtEnd(
                        el.scrollHeight - el.scrollTop - el.clientHeight < 80,
                      );
                    }}
                  >
                    {messages.length === 0 ? (
                      <EmptyChat />
                    ) : (
                      <div className="message-flow">
                        {messages.map((m, i) => (
                          <div
                            key={m.id}
                            id={`message-${m.id}`}
                            className={
                              searchMessageId === m.id
                                ? "search-message-hit"
                                : ""
                            }
                          >
                            {i > 0 && m.topicId !== messages[i - 1].topicId && (
                              <div className="topic-divider">
                                <span>{t("Yeni konu başladı")}</span>
                              </div>
                            )}
                            <MessageItem
                              presences={state.presences}
                              message={m}
                              character={state.characters.find(
                                (c) => c.id === m.from,
                              )}
                              names={nameOf}
                              observed={Boolean(
                                chat.observer &&
                                m.from !== "user" &&
                                !m.recipients.includes("user"),
                              )}
                              reply={state.messages.find(
                                (x) => x.id === m.replyTo,
                              )}
                              replyVisible={(() => {
                                const r = state.messages.find(
                                  (x) => x.id === m.replyTo,
                                );
                                return r ? isReplyVisible(r) : false;
                              })()}
                              onReply={
                                chat.observer || chat.status !== "open"
                                  ? undefined
                                  : (target) => {
                                      setReplyTarget(target);
                                    }
                              }
                              onDelete={(target) => {
                                if (
                                  window.confirm(
                                    t(
                                      "Bu mesajı silmek istediğine emin misin?",
                                    ),
                                  )
                                ) {
                                  act("message.delete", {
                                    chatId: chat.id,
                                    id: target.id,
                                  });
                                }
                              }}
                              canDelete={
                                !chat.observer && chat.status === "open"
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Konuşma Bütçesi Doldu Uyarısı */}
                    {Boolean(
                      (chat.maxTurns ?? 0) > 0 &&
                      (chat.turnCount || 0) >= (chat.maxTurns ?? 0),
                    ) && (
                      <div className="budget-alert-card">
                        <div className="budget-alert-header">
                          <AlertCircle size={16} />
                          <strong>
                            {t("Konuşma bütçesi doldu ({count}/{limit} tur)", {
                              count: chat.turnCount,
                              limit: chat.maxTurns,
                            })}
                          </strong>
                        </div>
                        <p className="budget-alert-desc">
                          {t(
                            "Ajanların karşılıklı döngüye girmemesi için konuşma duraklatıldı.",
                          )}
                        </p>
                        <div className="budget-alert-actions">
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={chat.observer || chat.status !== "open"}
                            onClick={() =>
                              act("chat.budget", { id: chat.id, addTurns: 5 })
                            }
                          >
                            {t("+5 Tur Ekle ve Sürdür")}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={chat.observer || chat.status !== "open"}
                            onClick={() =>
                              act("chat.budget", {
                                id: chat.id,
                                resetTurns: true,
                              })
                            }
                          >
                            {t("Sıfırla ve Sürdür")}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Hatalı Üretimler İçin Retry Kartı */}
                    {runs.some((r) => r.status === "error") && (
                      <div className="runs-alert">
                        {runs
                          .filter((r) => r.status === "error")
                          .slice(-2)
                          .map((r) => (
                            <div key={r.id} className="run-error-card">
                              <div className="run-error-header">
                                <AlertCircle size={15} />
                                <strong>
                                  {t("{name} yanıt üretemedi", {
                                    name: nameOf(r.characterId),
                                  })}
                                </strong>
                              </div>
                              <ErrorNotice
                                message={r.error || t("Yanıt üretilemedi.")}
                              />
                              {!chat.observer &&
                                chat.waiting &&
                                r.topicId === chat.topicId && (
                                  <button
                                    className="run-retry-btn"
                                    onClick={() =>
                                      act("run.retry", { id: r.id })
                                    }
                                  >
                                    <RotateCcw size={13} />
                                    <span>{t("Tekrar dene")}</span>
                                  </button>
                                )}
                            </div>
                          ))}
                      </div>
                    )}

                    {typingPeople.length > 0 && (
                      <div
                        className="typing-indicator-banner"
                        role="status"
                        aria-live="polite"
                      >
                        <span className="typing-dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                        <span>
                          {t("{names} yazıyor…", {
                            names: typingPeople.map((c) => c.name).join(", "),
                          })}
                        </span>
                      </div>
                    )}
                    <div ref={end} />
                  </div>

                  {/* Mesaj Yazma Alanı (Composer) */}
                  <div className="composer-container">
                    <div className="composer-anchor">
                      {!atEnd && messages.length > 0 && (
                        <button
                          type="button"
                          className="jump-to-end-btn"
                          onClick={() => {
                            end.current?.scrollIntoView({ behavior: "smooth" });
                            setAtEnd(true);
                          }}
                        >
                          <ArrowDown size={14} />
                          <span>{t("Son mesaja git")}</span>
                        </button>
                      )}

                      {unreadOnly ? (
                        <div className="composer-readonly">
                          <Eye size={16} />
                          <span>
                            {t("Gözlem modundasın · Okuma salt okunurdur.")}
                          </span>
                          <button
                            className="btn-text-action"
                            onClick={() =>
                              act("chat.observe", { id: chat.id, value: false })
                            }
                          >
                            {t("Yazışmaya dön")}
                          </button>
                        </div>
                      ) : chat.status === "closed" ? (
                        <div className="composer-readonly">
                          <Folder size={16} />
                          <span>
                            {t("Bu sohbet arşivlendi. Yeni mesaj yazılamaz.")}
                          </span>
                        </div>
                      ) : (
                        <form className="composer-card" onSubmit={send}>
                          <input
                            ref={mediaInput}
                            className="media-file-input"
                            type="file"
                            multiple
                            aria-label={t("Medya dosyası seç")}
                            onChange={(e) => {
                              addFiles(Array.from(e.target.files || []));
                              e.target.value = "";
                            }}
                          />
                          {replyTarget && (
                            <div className="reply-preview-banner">
                              <div className="reply-preview-content">
                                <Reply size={14} />
                                <div className="reply-preview-text">
                                  <strong>
                                    {t("{name} adlı katılımcıya yanıt:", {
                                      name: nameOf(replyTarget.from),
                                    })}
                                  </strong>
                                  <span>
                                    {replyTarget.deleted
                                      ? t("Bu mesaj silindi.")
                                      : !isReplyVisible(replyTarget)
                                        ? t("[Özel mesaj içeriği]")
                                        : replyTarget.content.slice(0, 80) ||
                                          (replyTarget.attachments || [])
                                            .map((a) => mediaLabel(a.kind))
                                            .join(", ")}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="reply-cancel-btn"
                                title={t("Yanıtı iptal et")}
                                onClick={() => setReplyTarget(null)}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          )}

                          <ComposerAttachments
                            key={draftScope}
                            media={pendingMedia}
                            disabled={busy}
                            onOpen={(media, focusTarget) =>
                              setOpenedMedia({
                                media,
                                url: media.url,
                                draft: media,
                                focusTarget,
                              })
                            }
                            onRemove={removePending}
                          />
                          <div className="composer-input-row">
                            <button
                              className="composer-attach"
                              type="button"
                              aria-label={t("Medya ekle")}
                              title={t("Fotoğraf, ses, video veya dosya ekle")}
                              disabled={busy || pendingMedia.length >= 6}
                              onClick={() => mediaInput.current?.click()}
                            >
                              <Paperclip size={19} />
                            </button>
                            <MentionComposer
                              key={`${chat.id}:${chat.topicId}:${chat.observer}:${chat.status}:${composerRevision}`}
                              draft={draft}
                              memory={composerMemory}
                              onDraft={setDraft}
                              media={pendingMedia}
                              onMediaPositions={movePending}
                              onRemoveMedia={removePending}
                              onRetainMedia={(ids) => {
                                for (const [id] of retainedMedia.current)
                                  if (!ids.has(id)) {
                                    void window.agentalk.discardMedia(id);
                                    retainedMedia.current.delete(id);
                                  }
                              }}
                              onCaret={(position) => {
                                insertionPosition.current = position;
                              }}
                              participants={participants}
                              group={Boolean(isGroup)}
                              onTargets={setTargetIds}
                              onSend={() => void send()}
                            />
                            <button
                              className="send-btn"
                              aria-label={t("Mesaj gönder")}
                              type="submit"
                              disabled={
                                (!draft.trim() && !pendingMedia.length) || busy
                              }
                              title={t("Gönder (Enter)")}
                            >
                              <ArrowUp size={16} strokeWidth={2.4} />
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </div>
                  {openedMedia && (
                    <MediaDetail
                      key={openedMedia.media.id}
                      selection={openedMedia}
                      onClose={() => setOpenedMedia(null)}
                    >
                      {openedMedia.draft &&
                      !unreadOnly &&
                      chat.status === "open" ? (
                        <MediaPreview
                          editDraft={openedMedia.draft}
                          existingBytes={pendingMedia
                            .filter(
                              (media) => media.id !== openedMedia.media.id,
                            )
                            .reduce((sum, media) => sum + media.bytes, 0)}
                          chatId={chat.id}
                          topicId={chat.topicId}
                          onCancel={() => setOpenedMedia(null)}
                          onAdd={(items) => {
                            const edited = items[0];
                            if (!edited) return;
                            retainedMedia.current.set(edited.id, edited);
                            pendingMediaRef.current =
                              pendingMediaRef.current.map((item) =>
                                item.id === openedMedia.media.id
                                  ? { ...edited, position: item.position }
                                  : item,
                              );
                            setPendingMedia(pendingMediaRef.current);
                            setOpenedMedia(null);
                          }}
                        />
                      ) : undefined}
                    </MediaDetail>
                  )}
                </section>
              </MediaOpenContext.Provider>

              {/* GEREKTİĞİNDE AÇILAN ÇEKMECELER (Sağda sürekli açık kolon yok) */}
              {isGroup && activeDrawer === "participants" && (
                <aside
                  className="drawer-panel"
                  aria-label={t("Masa Katılımcıları")}
                >
                  <div className="drawer-header">
                    <h3>
                      {t("Katılımcılar (")}
                      {participants.length + 1})
                    </h3>
                    <IconButton
                      title={t("Kapat")}
                      onClick={() => setActiveDrawer(null)}
                    >
                      <X size={16} />
                    </IconButton>
                  </div>
                  <div className="drawer-body">
                    {/* Kullanıcı */}
                    <div className="drawer-participant-row">
                      <Avatar name={t("Sen")} user size="small" />
                      <div className="drawer-participant-info">
                        <strong>{t("Sen")}</strong>
                        <small>{t("Oturum sahibi")}</small>
                      </div>
                      <span className="tag-chip">{t("Sen")}</span>
                    </div>

                    {/* AI Katılımcılar */}
                    {participants.map((c) => {
                      return (
                        <div key={c.id} className="drawer-participant-row">
                          <Avatar
                            photo={c.photo}
                            name={c.name}
                            color={c.color}
                            size="small"
                          />
                          <div className="drawer-participant-info">
                            <span className="person-name-line">
                              <strong>{c.name}</strong>
                              <small title={c.role}>{c.role}</small>
                            </span>
                          </div>
                          <IconButton
                            title={t("{v0} klasörünü aç", { v0: c.name })}
                            onClick={() =>
                              attempt(() =>
                                window.agentalk.reveal(chat.id, c.id),
                              )
                            }
                          >
                            <Folder size={14} />
                          </IconButton>
                        </div>
                      );
                    })}

                    {chat.kind !== "direct" && (
                      <div className="drawer-actions">
                        <button
                          className="btn-outline-primary"
                          onClick={() => setModal("add-ai")}
                        >
                          <Plus size={14} />
                          <span>{t("Gruba kişi ekle")}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </aside>
              )}
            </div>
          </>
        ) : (
          <div className="no-chat-selected">
            {sidebarCollapsed && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSidebarCollapsed(false)}
                style={{ marginBottom: "14px" }}
                title={t("Kenar çubuğunu aç (⌘B)")}
              >
                <PanelLeftOpen size={15} />
                <span>{t("Kenar çubuğunu aç (⌘B)")}</span>
              </button>
            )}
            <img className="brand-mark welcome-brand" src={BRAND.icon} alt="" />
            <h2>{t("Kişilerle başla, bir grupta buluş")}</h2>
            <p>
              {t(
                "Sol bardan kişi ekle; birebir konuş veya kayıtlı kişilerle bir grup oluştur.",
              )}
            </p>
            <button className="btn-primary" onClick={() => setModal("chat")}>
              <Plus size={15} />
              <span>{t("Yeni grup oluştur")}</span>
            </button>
          </div>
        )}
      </main>

      {mediaFiles && chat && (
        <Modal
          title={t("Medya önizlemesi")}
          subtitle={t("Göndermeden önce boyut ve kaliteyi ayarla.")}
          maxWidth="940px"
          className="media-preview-modal"
          onClose={() => setMediaFiles(null)}
        >
          <MediaPreview
            files={mediaFiles}
            existingBytes={pendingMedia.reduce(
              (sum, media) => sum + media.bytes,
              0,
            )}
            chatId={chat.id}
            topicId={chat.topicId}
            onCancel={() => setMediaFiles(null)}
            onAdd={(items) => {
              for (const item of items)
                retainedMedia.current.set(item.id, item);
              pendingMediaRef.current = [
                ...pendingMediaRef.current,
                ...items.map((m) => ({
                  ...m,
                  position: mediaInsertion.current,
                })),
              ];
              setPendingMedia(pendingMediaRef.current);
              setMediaFiles(null);
            }}
          />
        </Modal>
      )}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="dropdown-menu sidebar-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.person && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setEditingCharacter(contextMenu.person!);
                  setContextMenu(null);
                }}
              >
                <Settings size={15} />
                <span>{t("Kişi bilgileri")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  act("character.archive", {
                    id: contextMenu.person!.id,
                    value: !contextMenu.person!.archived,
                  });
                  setContextMenu(null);
                }}
              >
                <Folder size={15} />
                <span>
                  {contextMenu.person.archived
                    ? t("Arşivden çıkar")
                    : t("Kişiyi arşivle")}
                </span>
              </button>
              <button
                role="menuitem"
                disabled={contextMenu.person.archived}
                onClick={() => {
                  act("character.enable", {
                    id: contextMenu.person!.id,
                    value: !contextMenu.person!.enabled,
                  });
                  setContextMenu(null);
                }}
              >
                <Square size={15} />
                <span>
                  {contextMenu.person.enabled
                    ? t("Kişiyi duraklat")
                    : t("Kişiyi etkinleştir")}
                </span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  act("character.clone", { id: contextMenu.person!.id });
                  setContextMenu(null);
                }}
              >
                <Copy size={15} />
                <span>{t("Kişiyi çoğalt")}</span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  attempt(() =>
                    window.agentalk.exportCharacter(contextMenu.person!.id),
                  );
                  setContextMenu(null);
                }}
              >
                <Download size={15} />
                <span>{t("Şablonu dışa aktar")}</span>
              </button>
              <div className="dropdown-divider" />
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  const person = contextMenu.person!;
                  setContextMenu(null);
                  if (
                    window.confirm(
                      t(
                        "Kişi listeden kaldırılacak ve yanıtları durdurulacak. Geçmiş mesajları korunur. Devam edilsin mi?",
                      ),
                    )
                  )
                    act("character.delete", { id: person.id });
                }}
              >
                <Trash2 size={15} />
                <span>{t("Kişiyi sil")}</span>
              </button>
            </>
          )}
          {contextMenu.group && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setSettingsChat(contextMenu.group!);
                  setModal("group-settings");
                  setContextMenu(null);
                }}
              >
                <Settings size={15} />
                <span>{t("Grup bilgileri")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  act("chat.clone", { id: contextMenu.group!.id });
                  setContextMenu(null);
                }}
              >
                <Copy size={15} />
                <span>{t("Grubu çoğalt")}</span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  attempt(() =>
                    window.agentalk.exportChat(contextMenu.group!.id),
                  );
                  setContextMenu(null);
                }}
              >
                <Download size={15} />
                <span>{t("Sohbeti dışa aktar")}</span>
              </button>
              <button
                role="menuitem"
                disabled={
                  contextMenu.group.observer ||
                  contextMenu.group.status !== "open"
                }
                onClick={() => {
                  act("chat.close", { id: contextMenu.group!.id });
                  setContextMenu(null);
                }}
              >
                <Folder size={15} />
                <span>{t("Grubu arşivle")}</span>
              </button>
              <div className="dropdown-divider" />
              <button
                role="menuitem"
                className="danger"
                disabled={contextMenu.group.observer}
                onClick={() => {
                  const group = contextMenu.group!;
                  setContextMenu(null);
                  if (
                    window.confirm(
                      t(
                        "Grup listeden kaldırılacak. Geçmiş mesajları korunur. Devam edilsin mi?",
                      ),
                    )
                  )
                    act("chat.delete", { id: group.id });
                }}
              >
                <Trash2 size={15} />
                <span>{t("Grubu sil")}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* TOAST BİLDİRİMİ */}
      {error && (
        <div className="toast" role="alert">
          <AlertCircle size={16} />
          <ErrorNotice message={error} />
          <IconButton title={t("Bildirimi kapat")} onClick={() => setError("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}

      {/* MODALLAR */}

      {/* 1. YENİ SOHBET MODALI */}
      {modal === "chat" && (
        <ChatForm
          state={state}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            if (await act("chat.create", data)) {
              setModal(null);
            }
          }}
        />
      )}

      {modal === "group-settings" && settingsChat && (
        <ChatForm
          key={settingsChat.id}
          state={state}
          chat={settingsChat}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            if (await act("chat.settings", { ...data, id: settingsChat.id }))
              setModal(null);
          }}
        />
      )}

      {/* 2. SOHBETE AI EKLE MODALI (Sohbet aç → AI ekle → Konuş) */}
      {modal === "add-ai" && chat && (
        <AddAIModal
          state={state}
          chat={chat}
          busy={busy}
          onClose={() => setModal(null)}
          onInvite={async (characterId) => {
            if (await act("chat.invite", { chatId: chat.id, characterId })) {
              setModal(null);
            }
          }}
        />
      )}

      {/* 4. AYARLAR MODALI (Karakterler, Bağlantılar, Görünüm/Tema, Depolama, Kılavuz) */}
      {modal === "settings" && (
        <SettingsModal
          key={settingsRevision}
          state={state}
          initialTab={settingsTab}
          currentTheme={theme}
          appearance={appearance}
          onSelectAppearance={setAppearance}
          onSelectTheme={setTheme}
          busy={busy}
          onClose={() => setModal(null)}
          onOpenNewConnection={() => setModal("connection")}
          onTestConnection={(c) => window.agentalk.models(c.id)}
          onUpdateConnectionKey={(id, apiKey) =>
            act("connection.updateKey", { id, apiKey })
          }
          onDeleteConnection={(id) =>
            attempt(() => act("connection.delete", { id }))
          }
          onRevealDataPath={() => attempt(() => window.agentalk.reveal())}
        />
      )}

      {/* 5. KARAKTER OLUŞTURMA FORMU (Ayarlar içinden çağrıldığında) */}
      {modal === "character" && (
        <CharacterFormModal
          state={state}
          initialConnectionId={newCharConnectionId}
          initialModel={newCharModel}
          busy={busy}
          onClose={() => {
            setNewCharConnectionId(undefined);
            setModal(null);
          }}
          onConnection={() => setPersonConnectionModal(true)}
          onSave={async (data) => {
            if (await act("character.create", data)) {
              setNewCharConnectionId(undefined);
              setModal(null);
            }
          }}
        />
      )}

      {/* 5.1 KARAKTER DÜZENLEME FORMU */}
      {editingCharacter && (
        <CharacterEditModal
          character={editingCharacter}
          connections={state.connections}
          busy={busy}
          onClose={() => setEditingCharacter(null)}
          onToggle={() => {
            act("character.enable", {
              id: editingCharacter.id,
              value: !editingCharacter.enabled,
            });
            setEditingCharacter(null);
          }}
          onArchive={() => {
            act("character.archive", {
              id: editingCharacter.id,
              value: !editingCharacter.archived,
            });
            setEditingCharacter(null);
          }}
          onClone={() => {
            act("character.clone", { id: editingCharacter.id });
            setEditingCharacter(null);
          }}
          onExport={() =>
            attempt(() => window.agentalk.exportCharacter(editingCharacter.id))
          }
          onSave={async (data) => {
            if (await act("character.update", data)) {
              setEditingCharacter(null);
            }
          }}
        />
      )}

      {personConnectionModal && (
        <ConnectionFormModal
          busy={busy}
          onClose={() => setPersonConnectionModal(false)}
          onSave={async (data) => {
            if (await act("connection.create", data))
              setPersonConnectionModal(false);
          }}
        />
      )}

      {/* 6. BAĞLANTI EKLE FORMU */}
      {modal === "connection" && (
        <ConnectionFormModal
          busy={busy}
          onClose={() => setModal("settings")}
          onSave={async (data) => {
            if (await act("connection.create", data)) {
              setModal("settings");
              setSettingsTab("connections");
            }
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// BOŞ SOHBET GÖRÜNÜMÜ (Minimalist, Apple estetiğinde)
// ----------------------------------------------------------------------
function EmptyChat() {
  return (
    <div className="empty-conversation">
      <MessageCircle size={28} strokeWidth={1.4} />
      <h2>{t("Sohbet burada başlıyor")}</h2>
      <p>{t("İlk mesajını yaz.")}</p>
    </div>
  );
}

function MessageItem({
  message: m,
  character,
  names,
  observed,
  reply,
  replyVisible = true,
  onReply,
  onDelete,
  canDelete,
  presences,
}: {
  presences?: Snapshot["presences"];
  message: Message;
  character?: Character;
  names: (id: string) => string;
  observed: boolean;
  reply?: Message;
  replyVisible?: boolean;
  onReply?: (m: Message) => void;
  onDelete?: (m: Message) => void;
  canDelete?: boolean;
}) {
  const isUser = m.from === "user";
  const readCount = m.recipients.filter((id) =>
    Boolean(m.readTimes?.[id]),
  ).length;
  const allRead = m.recipients.length > 0 && readCount === m.recipients.length;
  const allDelivered =
    m.recipients.length > 0 &&
    m.recipients.every((id) =>
      Boolean(m.deliveredTimes?.[id] || m.readTimes?.[id]),
    );
  const receiptLabel = allRead
    ? t("Okundu")
    : readCount > 0
      ? t("Kısmen okundu")
      : allDelivered
        ? t("Teslim edildi")
        : t("Gönderildi");

  return (
    <article
      className={`message-card ${isUser ? "from-user" : "from-ai"} ${observed ? "observed-msg" : ""} ${m.deleted ? "is-deleted" : ""}`}
    >
      <div className="message-avatar-col">
        <Avatar
          name={names(m.from)}
          color={character?.color}
          photo={character?.photo}
          user={isUser}
          size="small"
        />
      </div>

      <div className="message-content-col">
        <div className="message-header-line">
          <strong className="sender-name">{names(m.from)}</strong>
          {character?.role && (
            <span className="role-tag" title={character.role}>
              {character.role}
            </span>
          )}
          <span className="route-arrow">→</span>
          <span className="target-name">
            {m.to.length === 1 && m.to[0] === "all"
              ? t("Herkes")
              : m.to.map(names).join(", ")}
          </span>

          {observed && (
            <span className="observed-chip">
              <Eye size={11} />
              <span>{t("Gözlem")}</span>
            </span>
          )}

          {!m.deleted && (
            <div className="message-actions-inline">
              {onReply && (
                <button
                  type="button"
                  className="msg-btn-reply"
                  title={t("Yanıtla")}
                  onClick={() => onReply(m)}
                >
                  <Reply size={12} />
                  <span>{t("Yanıtla")}</span>
                </button>
              )}
              {canDelete && onDelete && (
                <button
                  type="button"
                  className="msg-btn-delete"
                  title={t("Mesajı sil")}
                  onClick={() => onDelete(m)}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {reply && (
          <div className="reply-quote whatsapp-style">
            <span className="reply-sender">{names(reply.from)}:</span>
            <span className="reply-snippet">
              {reply.deleted
                ? t("Bu mesaj silindi.")
                : !replyVisible
                  ? t("[Özel mesaj içeriği]")
                  : reply.content.slice(0, 100) ||
                    (reply.attachments || [])
                      .map((a) => mediaLabel(a.kind))
                      .join(", ")}
            </span>
          </div>
        )}

        {!m.deleted && m.attachments?.length ? (
          <MediaContent
            attachments={m.attachments}
            chatId={m.chatId}
            content={m.content}
          />
        ) : null}
        <div className={`message-body-text ${m.deleted ? "deleted-text" : ""}`}>
          {m.deleted ? (
            <em>{t("Bu mesaj silindi.")}</em>
          ) : !m.attachments?.length ? (
            m.content
          ) : null}
        </div>

        <div className="message-footer">
          <details className="message-details-fold">
            <summary>
              <span>{t("Mesaj ayrıntısı")}</span>
              <ChevronDown size={11} />
            </summary>
            <div className="details-drawer-content">
              <span>{t("Sıra #{count}", { count: m.sequence })}</span>
              <span>·</span>
              <span>
                {t("{count} kutuya teslim edildi", {
                  count: m.recipients.length,
                })}
              </span>
              {m.recipients.map((pid) => (
                <span key={pid}>
                  {names(pid)}:{" "}
                  {m.readTimes?.[pid] ? t("Okundu") : t("Henüz görülmedi")} ·{" "}
                  {presences?.[pid]?.online ? t("Açık") : t("Çevrimdışı")}
                </span>
              ))}
              <span>·</span>
              <code>{m.id.slice(0, 8)}</code>
            </div>
          </details>
          <div className="message-status">
            <time className="message-time" dateTime={m.time}>
              {new Date(m.time).toLocaleTimeString(
                document.documentElement.lang,
                { hour: "2-digit", minute: "2-digit" },
              )}
            </time>
            {isUser && !m.deleted && (
              <span
                className="read-receipt-ticks"
                title={[
                  t(receiptLabel),
                  ...m.recipients.map(
                    (pid) =>
                      `${names(pid)}: ${m.readTimes?.[pid] ? t("Okundu") : t("Henüz görülmedi")} · ${presences?.[pid]?.online ? t("Açık") : t("Çevrimdışı")}`,
                  ),
                ].join("\n")}
                aria-label={t(receiptLabel)}
                data-status={
                  allRead
                    ? "read"
                    : readCount
                      ? "partial"
                      : allDelivered
                        ? "delivered"
                        : "sent"
                }
              >
                <ReceiptTicks double={allDelivered || allRead} read={allRead} />
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// ----------------------------------------------------------------------
// SOHBETE AI EKLE MODALI (Sohbet aç → AI ekle → Konuş)
// ----------------------------------------------------------------------
function AddAIModal({
  state,
  chat,
  busy,
  onClose,
  onInvite,
}: {
  state: Snapshot;
  chat: Chat;
  busy: boolean;
  onClose: () => void;
  onInvite: (id: string) => void;
}) {
  const available = state.characters.filter(
    (c) => !c.deleted && !c.archived && !chat.participantIds.includes(c.id),
  );
  return (
    <Modal
      title={t("Gruba kişi ekle")}
      subtitle={t("Daha önce oluşturduğun kişiler arasından seç.")}
      onClose={onClose}
    >
      <div className="character-pick-list">
        {available.map((c) => (
          <div key={c.id} className="character-pick-card">
            <Avatar
              photo={c.photo}
              name={c.name}
              color={c.color}
              size="small"
            />
            <div className="pick-card-info">
              <strong>{c.name}</strong>
              <small>{c.role}</small>
            </div>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => onInvite(c.id)}
            >
              {t("Gruba ekle")}
            </button>
          </div>
        ))}
      </div>
      {!available.length && (
        <p className="info-box">
          {t(
            "Eklenebilecek kişi yok. Sol bardaki Kişi ekle ile yeni bir kişi oluşturabilirsin.",
          )}
        </p>
      )}
    </Modal>
  );
}

// ----------------------------------------------------------------------
// YENİ SOHBET FORMU
// ----------------------------------------------------------------------
function ChatForm({
  state,
  chat,
  busy,
  onClose,
  onSave,
}: {
  state: Snapshot;
  chat?: Chat;
  busy: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description: string;
    participantIds: string[];
    rules: string;
    mode: ChatMode;
    heartbeatSeconds: number;
    maxParallel: number;
    maxTurns: number;
    replyStyle: string;
    respondToPeers: boolean;
    memberPreferences: Chat["memberPreferences"];
    photo: string;
  }) => void;
}) {
  const [photo, setPhoto] = useState(chat?.photo || "");
  const [selected, setSelected] = useState<string[]>(
    chat?.participantIds || [],
  );
  const [replyStyle, setReplyStyle] = useState(chat?.replyStyle || "balanced");
  const [respondToPeers, setRespondToPeers] = useState(
    chat?.respondToPeers ?? true,
  );
  const [memberPreferences, setMemberPreferences] = useState<
    NonNullable<Chat["memberPreferences"]>
  >(chat?.memberPreferences || {});
  const styleOptions = (
    <>
      <option value="concise">{t("Kısa ve somut")}</option>
      <option value="balanced">{t("Doğal ve dengeli")}</option>
      <option value="detailed">{t("Ayrıntılı ve gerekçeli")}</option>
    </>
  );
  return (
    <Modal
      title={
        chat
          ? chat.kind === "direct"
            ? t("Kişi bilgileri")
            : t("Grup bilgileri")
          : t("Yeni grup oluştur")
      }
      subtitle={
        chat
          ? t("Bu sohbetin cevap alışkanlıkları ve çalışma düzeni.")
          : t(
              "Önce kişilerini seç, sonra bu grubun nasıl konuşacağını belirle.",
            )
      }
      onClose={onClose}
      maxWidth="720px"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          onSave({
            name: String(d.get("name")),
            description: String(d.get("description") || ""),
            participantIds: selected,
            rules: String(d.get("rules") || ""),
            mode: String(d.get("mode")) as ChatMode,
            heartbeatSeconds: Number(d.get("heartbeatSeconds")),
            maxParallel: Number(d.get("maxParallel")),
            maxTurns: Number(d.get("maxTurns")),
            replyStyle,
            respondToPeers,
            memberPreferences,
            photo,
          });
        }}
      >
        <fieldset
          className="info-fieldset"
          disabled={Boolean(chat && (chat.observer || chat.status !== "open"))}
        >
          <ProfilePhoto value={photo} onChange={setPhoto} />
          <div className="form-group-grid">
            <label className="input-field">
              <span>
                {chat?.kind === "direct" ? t("Sohbet adı") : t("Grup adı")}
              </span>
              <input
                name="name"
                aria-label={t("Grup adı")}
                defaultValue={chat?.name}
                required
                maxLength={100}
                placeholder={t("Örn. Ürün ekibi")}
              />
            </label>
            <label className="input-field">
              <span>{t("Kısa açıklama")}</span>
              <input
                name="description"
                aria-label={t("Kısa açıklama")}
                defaultValue={chat?.description}
                maxLength={300}
                placeholder={t("Bu grupta ne konuşacağız?")}
              />
            </label>
          </div>
          <div className="select-characters-section">
            <label className="field-group-title">
              {chat ? t("Grubun kişileri") : t("Kayıtlı kişilerden seç")}
            </label>
            {!state.characters.some((c) => !c.deleted && !c.archived) && (
              <div className="warning-box">
                {t("Grup oluşturmak için önce sol bardan bir kişi ekle.")}
              </div>
            )}
            <div className="group-member-list">
              {state.characters
                .filter(
                  (c) =>
                    !c.deleted &&
                    (chat ? selected.includes(c.id) : !c.archived),
                )
                .map((c) => {
                  const pref = memberPreferences[c.id] || {
                    replyStyle,
                    respondToPeers,
                  };
                  const update = (patch: Partial<typeof pref>) =>
                    setMemberPreferences((previous) => ({
                      ...previous,
                      [c.id]: { ...pref, ...patch },
                    }));
                  return (
                    <div
                      className={`group-member-card ${selected.includes(c.id) ? "selected" : ""}`}
                      key={c.id}
                    >
                      <label className="character-checkbox-item">
                        <input
                          type="checkbox"
                          aria-label={t("{v0} gruba katılsın", { v0: c.name })}
                          checked={selected.includes(c.id)}
                          disabled={Boolean(chat)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, c.id]
                                : selected.filter((id) => id !== c.id),
                            )
                          }
                        />
                        <Avatar
                          photo={c.photo}
                          name={c.name}
                          color={c.color}
                          size="small"
                        />
                        <span className="char-name">{c.name}</span>
                        <span className="char-role">{c.role}</span>
                      </label>
                      {selected.includes(c.id) && (
                        <div className="member-habits">
                          <label>
                            {t("Yanıt tarzı")}
                            <select
                              aria-label={t("{v0} yanıt tarzı", { v0: c.name })}
                              value={pref.replyStyle}
                              onChange={(e) =>
                                update({
                                  replyStyle: e.target
                                    .value as typeof replyStyle,
                                })
                              }
                            >
                              {styleOptions}
                            </select>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={pref.respondToPeers}
                              aria-label={t(
                                "{v0} diğer kişilere cevap versin",
                                {
                                  v0: c.name,
                                },
                              )}
                              onChange={(e) =>
                                update({ respondToPeers: e.target.checked })
                              }
                            />
                            {t("Diğer kişilere de cevap verir")}
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
          <div className="group-preferences-section">
            <h3>{t("Konuşma alışkanlıkları")}</h3>
            <div className="form-group-grid">
              <label className="input-field">
                <span>{t("Cevap verme")}</span>
                <select
                  name="mode"
                  aria-label={t("Cevap verme")}
                  defaultValue={chat?.mode || "free"}
                >
                  <option value="free">
                    {t("İlgili mesajlara serbestçe")}
                  </option>
                  <option value="mention_only">
                    {t("Yalnızca doğrudan hitap edilince")}
                  </option>
                </select>
              </label>
              <label className="input-field">
                <span>{t("Varsayılan yanıt tarzı")}</span>
                <select
                  aria-label={t("Varsayılan yanıt tarzı")}
                  value={replyStyle}
                  onChange={(e) =>
                    setReplyStyle(e.target.value as typeof replyStyle)
                  }
                >
                  {styleOptions}
                </select>
              </label>
            </div>
            <label className="habit-toggle">
              <input
                type="checkbox"
                aria-label={t("Kişiler birbirine cevap versin")}
                checked={respondToPeers}
                onChange={(e) => setRespondToPeers(e.target.checked)}
              />
              {t("Kişiler birbirinin mesajlarına da cevap verebilir")}
            </label>
          </div>
          <div className="group-preferences-section">
            <h3>{t("Çalışma düzeni")}</h3>
            <div className="form-group-grid">
              <label className="input-field">
                <span>{t("Heartbeat (saniye)")}</span>
                <input
                  name="heartbeatSeconds"
                  aria-label={t("Heartbeat saniye")}
                  type="number"
                  min={0}
                  max={60}
                  step={0.5}
                  defaultValue={chat?.heartbeatSeconds ?? 1}
                  onBlur={(e) => {
                    if (!e.target.value) e.target.value = e.target.min;
                  }}
                  required
                />
                <small>
                  {t(
                    "Yeni mesajları kontrol etme aralığı. 0: anında. Boşta mesaj üretilmez.",
                  )}
                </small>
              </label>
              <label className="input-field">
                <span>{t("Aynı anda cevap verebilen kişi")}</span>
                <input
                  name="maxParallel"
                  aria-label={t("Eşzamanlı cevap sayısı")}
                  type="number"
                  min={1}
                  max={8}
                  defaultValue={chat?.maxParallel || 4}
                  onBlur={(e) => {
                    if (!e.target.value) e.target.value = e.target.min;
                  }}
                  required
                />
                <small>
                  {t(
                    "Kişiler bağımsız çalışır. Bağlantı kapasitesi de uygulanır.",
                  )}
                </small>
              </label>
              <label className="input-field">
                <span>{t("Tur bütçesi (AI yanıtları)")}</span>
                <input
                  name="maxTurns"
                  aria-label={t("Yanıt bütçesi")}
                  type="number"
                  min={0}
                  max={10000}
                  defaultValue={chat?.maxTurns || 0}
                  onBlur={(e) => {
                    if (!e.target.value) e.target.value = e.target.min;
                  }}
                  required
                />
                <small>
                  {t("0: sınırsız. Sınıra gelince sohbet duraklatılır.")}
                </small>
              </label>
            </div>
            {selected.some(
              (id) =>
                state.connections.find(
                  (conn) =>
                    conn.id ===
                    state.characters.find((c) => c.id === id)?.connectionId,
                )?.concurrency === 1,
            ) && (
              <p className="group-capacity-note">
                {t(
                  "Seçili kişilerden birinin bağlantı kapasitesi 1. Aynı bağlantıdaki kişilerin eşzamanlı cevap vermesi için Ayarlar → API bağlantıları’ndan kapasiteyi artırabilirsin.",
                )}
              </p>
            )}
          </div>
          <label className="input-field">
            <span>{t("Masa kuralları ve talimatlar")}</span>
            <textarea
              name="rules"
              aria-label={t("Grup talimatları")}
              rows={3}
              defaultValue={
                chat?.rules ||
                t(
                  "Türkçe ve kısa katkılar sun. Yalnızca sana teslim edilen mesajları kullan. Başka katılımcı adına yazma. Yeni katkın yoksa cevap üretme. Kullanıcının yönlendirmesi önceliklidir. Yanıt sonrasında beklemeye dön.",
                )
              }
              placeholder={t(
                "Bu grubun amacı, tonu ve birlikte çalışma kuralları…",
              )}
            />
          </label>
        </fieldset>
        <div className="modal-actions-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={
              busy ||
              !selected.length ||
              Boolean(chat && (chat.observer || chat.status !== "open"))
            }
            aria-label={chat ? t("Grup ayarlarını kaydet") : t("Grubu oluştur")}
          >
            {chat ? t("Ayarları kaydet") : t("Grubu oluştur")}
            <ArrowUpRight size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------
// KARAR PANOSU FORMU
// ----------------------------------------------------------------------
function SettingsModal({
  state,
  initialTab,
  currentTheme,
  appearance,
  onSelectAppearance,
  onSelectTheme,
  busy,
  onClose,
  onOpenNewConnection,
  onTestConnection,
  onUpdateConnectionKey,
  onDeleteConnection,
  onRevealDataPath,
}: {
  state: Snapshot;
  initialTab: "general" | "connections" | "about";
  currentTheme: ThemeId;
  appearance: Appearance;
  onSelectAppearance: (appearance: Appearance) => void;
  onSelectTheme: (t: ThemeId) => void;
  busy: boolean;
  onClose: () => void;
  onOpenNewConnection: () => void;
  onTestConnection: (c: Connection) => Promise<unknown>;
  onUpdateConnectionKey?: (id: string, apiKey: string) => Promise<unknown>;
  onDeleteConnection?: (id: string) => Promise<unknown>;
  onRevealDataPath: () => void;
}) {
  const locale = useLocale();
  const [tab, setTab] = useState(initialTab);
  const [testingId, setTestingId] = useState("");
  const [testError, setTestError] = useState("");
  const [editingKeyConnection, setEditingKeyConnection] =
    useState<Connection | null>(null);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const currentThemeConfig = THEMES.find((item) => item.id === currentTheme)!;

  const runTest = async (c: Connection) => {
    setTestingId(c.id);
    setTestError("");
    try {
      await onTestConnection(c);
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setTestingId("");
    }
  };

  const handleDeleteConnection = async (c: Connection) => {
    const charsUsing = state.characters.filter(
      (x) => !x.deleted && x.connectionId === c.id,
    );
    if (charsUsing.length > 0) {
      alert(
        t(
          "Bu bağlantı '{v0}' karakterleri tarafından kullanılıyor. Önce bu karakterlerin bağlantısını değiştirin veya silin.",
          { v0: charsUsing.map((x) => x.name).join(", ") },
        ),
      );
      return;
    }
    if (
      confirm(
        t(
          "'{v0}' bağlantısını ve kasadaki anahtarını silmek istediğinize emin misiniz?",
          { v0: c.name },
        ),
      )
    ) {
      if (onDeleteConnection) {
        await onDeleteConnection(c.id);
      }
    }
  };

  return (
    <Modal
      title={t("Ayarlar")}
      subtitle={t("API bağlantıları, görünüm ve veri alanı.")}
      onClose={onClose}
      maxWidth="840px"
    >
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <button
            type="button"
            className={tab === "general" ? "active" : ""}
            onClick={() => setTab("general")}
          >
            <Layers3 size={16} />
            <span>{t("Genel")}</span>
          </button>
          <button
            type="button"
            className={tab === "connections" ? "active" : ""}
            onClick={() => setTab("connections")}
          >
            <Link2 size={16} />
            <span>{t("API bağlantıları")}</span>
            <span className="count-tag">{state.connections.length}</span>
          </button>
          <button
            type="button"
            className={tab === "about" ? "active" : ""}
            onClick={() => setTab("about")}
          >
            <Sparkles size={16} />
            <span>{t("Hakkında")}</span>
          </button>
        </aside>

        <section className="settings-content">
          {/* TAB 2: BAĞLANTILAR */}
          {tab === "connections" && (
            <div className="settings-tab-panel">
              <div className="tab-panel-header">
                <div>
                  <h3>{t("API bağlantıları")}</h3>
                  <p>{t("Bulut ve yerel API bağlantılarını buradan yönet.")}</p>
                </div>
                <button
                  className="btn-primary"
                  onClick={onOpenNewConnection}
                  aria-label={t("API bağlantısı ekle")}
                >
                  <Plus size={14} />
                  <span>{t("API bağlantısı ekle")}</span>
                </button>
              </div>

              {testError && (
                <div className="warning-box" role="alert">
                  <ErrorNotice message={testError} />
                </div>
              )}
              {state.connections.length > 0 ? (
                <div className="entity-list">
                  {state.connections.map((c) => {
                    const provider = getProviderDetails(c);
                    return (
                      <div key={c.id} className="connection-row-card">
                        <div className="conn-type-icon">
                          {c.kind === "local" ? (
                            <Laptop size={18} />
                          ) : c.kind === "network" ? (
                            <Radio size={18} />
                          ) : (
                            <Cloud size={18} />
                          )}
                        </div>
                        <div className="conn-info">
                          <div className="conn-title">
                            <strong>{c.name}</strong>
                            <span className={`tag-chip ${provider.chipClass}`}>
                              {provider.badge}
                            </span>
                            <span className="tag-chip subtle">
                              {t(connectionLabels[c.kind])}
                            </span>
                          </div>
                          <details className="connection-details">
                            <summary>
                              {t("Ayrıntılar")} ·{" "}
                              {t("{count} model", {
                                count:
                                  getSuggestedModelsForConnection(c).length,
                              })}{" "}
                              ·{" "}
                              {t("{count} kişi", {
                                count: state.characters.filter(
                                  (x) => !x.deleted && x.connectionId === c.id,
                                ).length,
                              })}
                            </summary>
                            <div className="connection-details-body">
                              <small>{t(adapterLabels[c.adapter])}</small>
                              <code>{c.baseUrl}</code>
                              <div className="conn-details">
                                <label className="capacity-field">
                                  {t("Eşzamanlı istek")}{" "}
                                  <select
                                    aria-label={t("{v0} kapasitesi", {
                                      v0: c.name,
                                    })}
                                    value={c.concurrency}
                                    disabled={busy}
                                    onChange={(e) =>
                                      window.agentalk
                                        .command("connection.capacity", {
                                          id: c.id,
                                          concurrency: Number(e.target.value),
                                        })
                                        .catch((error) =>
                                          setTestError(error.message),
                                        )
                                    }
                                  >
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                                      <option key={n} value={n}>
                                        {n}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <span>·</span>
                                <span
                                  className={
                                    c.hasKey
                                      ? "vault-key-text active"
                                      : "vault-key-text"
                                  }
                                >
                                  {c.hasKey ? (
                                    <>
                                      <Lock size={12} />
                                      <span>{t("Kasada Şifreli Anahtar")}</span>
                                    </>
                                  ) : (
                                    <span>{t("Anahtarsız (Yerel/Açık)")}</span>
                                  )}
                                </span>
                              </div>
                              {getSuggestedModelsForConnection(c).length > 0 ? (
                                <div className="models-tags">
                                  {getSuggestedModelsForConnection(c)
                                    .slice(0, 8)
                                    .map((m) => (
                                      <span key={m} className="model-chip">
                                        {m}
                                      </span>
                                    ))}
                                  {c.models.length > 8 && (
                                    <span className="model-chip more">
                                      +{c.models.length - 8}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="no-models-row">
                                  <small className="no-models-hint">
                                    {t(
                                      "Model listesini almak için bağlantıyı sına. Liste keşfi, her modelin yanıt vereceğini garanti etmez.",
                                    )}
                                  </small>
                                </div>
                              )}

                              {c.modelsDiscoveredAt && (
                                <small className="model-discovery-time">
                                  {t("Son keşif:")}{" "}
                                  {new Date(
                                    c.modelsDiscoveredAt,
                                  ).toLocaleString(locale)}
                                </small>
                              )}
                              {/* Bu bağlantıyı kullanan karakterler */}
                              <div className="conn-assigned-characters">
                                <div className="assigned-chars-header">
                                  <span className="assigned-chars-title">
                                    <Users size={12} />
                                    <span>
                                      {t(
                                        "Bu bağlantıyı kullanan AI karakterleri (",
                                      )}
                                      {
                                        state.characters.filter(
                                          (x) =>
                                            !x.deleted &&
                                            x.connectionId === c.id,
                                        ).length
                                      }
                                      )
                                    </span>
                                  </span>
                                </div>
                                {state.characters.filter(
                                  (x) => !x.deleted && x.connectionId === c.id,
                                ).length > 0 ? (
                                  <div className="assigned-chars-tags">
                                    {state.characters
                                      .filter(
                                        (x) =>
                                          !x.deleted && x.connectionId === c.id,
                                      )
                                      .map((char) => (
                                        <span
                                          key={char.id}
                                          className="assigned-char-tag"
                                        >
                                          <span
                                            className="char-dot"
                                            style={{ background: char.color }}
                                          />
                                          <strong>{char.name}</strong>
                                          <span className="char-model-pill">
                                            {char.model || t("Varsayılan")}
                                          </span>
                                        </span>
                                      ))}
                                  </div>
                                ) : (
                                  <small className="no-assigned-hint">
                                    {t(
                                      "Henüz bu bağlantıya bağlı karakter yok. Farklı karakterler bu bağlantıyı farklı modellerle aynı anda kullanabilir.",
                                    )}
                                  </small>
                                )}
                              </div>
                            </div>
                          </details>
                          {c.modelDiscoveryError && (
                            <div className="connection-error">
                              <ErrorNotice message={c.modelDiscoveryError} />
                              <p>{t("Önceki liste güncel olmayabilir.")}</p>
                            </div>
                          )}
                        </div>
                        <div className="conn-action-group">
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            aria-label={t("Bağlantıyı sına")}
                            disabled={busy || testingId === c.id}
                            onClick={() => runTest(c)}
                            title={t(
                              "Bağlantıyı sına ve modelleri otomatik keşfet",
                            )}
                          >
                            <RefreshCw
                              size={13}
                              className={testingId === c.id ? "spinning" : ""}
                            />
                            <span>
                              {testingId === c.id
                                ? t("Sınanıyor…")
                                : t("Bağlantıyı sına")}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => setEditingKeyConnection(c)}
                            title={t("API anahtarını güncelle veya kaldır")}
                          >
                            <Key size={13} />
                            <span>{t("Anahtar")}</span>
                          </button>
                          <button
                            type="button"
                            className="btn-danger-ghost btn-sm"
                            disabled={busy}
                            onClick={() => handleDeleteConnection(c)}
                            title={t("Bağlantıyı sil")}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="settings-empty">
                  <Link2 size={32} />
                  <p>{t("Henüz bir API bağlantısı eklenmedi.")}</p>
                  <button
                    className="btn-secondary"
                    onClick={onOpenNewConnection}
                  >
                    <Plus size={14} />
                    <span>{t("İlk bağlantını kur")}</span>
                  </button>
                </div>
              )}

              {editingKeyConnection && (
                <UpdateKeyModal
                  connection={editingKeyConnection}
                  busy={busy}
                  onClose={() => setEditingKeyConnection(null)}
                  onSave={async (apiKey) => {
                    if (onUpdateConnectionKey) {
                      const saved = await onUpdateConnectionKey(
                        editingKeyConnection.id,
                        apiKey,
                      );
                      if (!saved) return;
                    }
                    setEditingKeyConnection(null);
                  }}
                />
              )}
            </div>
          )}

          {/* TAB: GENEL — TEMA */}
          {tab === "general" && (
            <div className="settings-tab-panel">
              <div className="tab-panel-header">
                <div>
                  <h3>{t("Genel")}</h3>
                  <p>
                    {t(
                      "Temanı seç, çalışma alanını ve anahtar kasasının durumunu görüntüle.",
                    )}
                  </p>
                </div>
              </div>

              <label className="input-field language-setting">
                <span>{t("Dil")}</span>
                <select
                  aria-label={t("Uygulama dili")}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                >
                  {LANGUAGES.map((language) => (
                    <option key={language.id} value={language.id}>
                      {language.name}
                    </option>
                  ))}
                </select>
                <small>
                  {t(
                    "İlk açılışta sistem dili seçilir. Desteklenmeyen dillerde İngilizce kullanılır.",
                  )}
                </small>
              </label>
              <div className="appearance-setting">
                <span>{t("Görünüm")}</span>
                <div className="segmented-tabs" aria-label={t("Görünüm")}>
                  {(["light", "dark"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={appearance === mode ? "active" : ""}
                      aria-pressed={appearance === mode}
                      onClick={() => onSelectAppearance(mode)}
                    >
                      {mode === "light" ? (
                        <Sun size={14} />
                      ) : (
                        <Moon size={14} />
                      )}
                      {mode === "light" ? t("Aydınlık") : t("Karanlık")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="theme-setting">
                <h4 className="general-section-title">{t("Tema")}</h4>
                <button
                  type="button"
                  className="theme-picker-trigger"
                  aria-label={t("Tema seç")}
                  aria-expanded={themePickerOpen}
                  aria-controls="theme-options"
                  onClick={() => setThemePickerOpen(!themePickerOpen)}
                >
                  <span className="theme-preview" aria-hidden="true">
                    {currentThemeConfig[appearance].map((color, i) => (
                      <i key={i} style={{ background: color }} />
                    ))}
                  </span>
                  <strong>{currentThemeConfig.name}</strong>
                  <ChevronDown
                    size={16}
                    className={themePickerOpen ? "rotated" : ""}
                  />
                </button>
                <div className="theme-picker-panel">
                  <DisclosurePanel
                    id="theme-options"
                    expanded={themePickerOpen}
                  >
                    <div className="theme-options-list">
                      {THEMES.map((config) => (
                        <button
                          type="button"
                          key={config.id}
                          data-theme-id={config.id}
                          className={`theme-option ${currentTheme === config.id ? "active" : ""}`}
                          aria-pressed={currentTheme === config.id}
                          onClick={() => {
                            onSelectTheme(config.id);
                            setThemePickerOpen(false);
                          }}
                        >
                          <span className="theme-preview" aria-hidden="true">
                            {config[appearance].map((color, i) => (
                              <i key={i} style={{ background: color }} />
                            ))}
                          </span>
                          <span>{config.name}</span>
                          {currentTheme === config.id && <Check size={15} />}
                        </button>
                      ))}
                    </div>
                  </DisclosurePanel>
                </div>
              </div>
            </div>
          )}

          {/* GENEL — VERİ VE GÜVENLİK */}
          {tab === "general" && (
            <div className="settings-tab-panel general-data-panel">
              <div className="tab-panel-header">
                <div>
                  <h3>{t("Veri ve güvenlik")}</h3>
                  <p>{t("Yerel dosya kayıtları ve kasa durumu.")}</p>
                </div>
              </div>

              <div className="storage-info-cards">
                <div className="info-card">
                  <div className="info-card-header">
                    <Folder size={18} />
                    <strong>{t("Çalışma Alanı Klasörü")}</strong>
                  </div>
                  <p>
                    {t(
                      "Tüm sohbetler, kurallar ve katılımcı gelen/giden kutuları bu dizinde saklanır.",
                    )}
                  </p>
                  <code className="code-path">{state.dataPath}</code>
                  <button
                    type="button"
                    className="btn-outline-primary"
                    onClick={onRevealDataPath}
                  >
                    <ExternalLink size={14} />
                    <span>{t("Finder'da / Dosyalarda Aç")}</span>
                  </button>
                </div>

                <div className="info-card">
                  <div className="info-card-header">
                    <ShieldCheck size={18} />
                    <strong>{t("Anahtar Kasası (safeStorage)")}</strong>
                  </div>
                  <p>
                    {state.vaultAvailable === null
                      ? t(
                          "Anahtar kasası, anahtar kaydedilirken veya kullanılırken denetlenir. İşletim sistemi erişim onayı isteyebilir.",
                        )
                      : state.vaultAvailable
                        ? t(
                            "İşletim sistemi kasa şifrelemesi devrede. API anahtarları düz metin kaydedilmez.",
                          )
                        : t(
                            "İşletim sistemi kasa şifrelemesi kullanılamıyor. Anahtar kaydedilemez.",
                          )}
                  </p>
                </div>

                <div className="info-card">
                  <div className="info-card-header">
                    <Radio size={18} />
                    <strong>{t("Dış Ajan Köprüsü")}</strong>
                  </div>
                  <p>
                    {t("Yerel dış ajanlar")}{" "}
                    <code>127.0.0.1:{state.bridgePort}</code>{" "}
                    {t("üzerinden token doğrulamasıyla bağlanır.")}
                  </p>
                  <small>
                    {t(
                      "Klasör ayrımı dış süreçleri işletim sistemi düzeyinde yalıtmaz. Bu ilk sürüm güvenilen ajanlarla kullanım içindir.",
                    )}
                  </small>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: HAKKINDA */}
          {tab === "about" && (
            <div className="settings-tab-panel">
              <div className="about-brand">
                <img className="brand-mark" src={BRAND.icon} alt="" />
                <h3>{BRAND.wordmark}</h3>
                <p className="brand-tagline">
                  {t("Bağımsız sesler. Ortak bir sohbet.")}
                </p>
                <small>
                  {t("Sürüm {version} · Masaüstü AI Sohbet Alanı", {
                    version: BRAND.version,
                  })}
                </small>
              </div>

              <div className="about-body">
                {testError && (
                  <div className="warning-box" role="alert">
                    <ErrorNotice message={testError} />
                  </div>
                )}
                <section className="about-licenses">
                  <h4>{t("Açık kaynak ve lisanslar")}</h4>
                  <p>
                    {t(
                      "React, Electron ve Lucide ile geliştirilmiştir. Kullanılan bileşenlerin telif ve lisans bildirimleri aşağıdadır.",
                    )}
                  </p>
                  {legalNotices.map((notice) => (
                    <details key={notice.name}>
                      <summary>
                        {notice.name}
                        <span>{notice.license}</span>
                      </summary>
                      <pre>{notice.text}</pre>
                    </details>
                  ))}
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() =>
                      window.agentalk
                        .openRuntimeNotices()
                        .catch((error) => setTestError(error.message))
                    }
                  >
                    <ExternalLink size={13} />
                    {t("Electron ve Chromium bildirimlerini aç")}
                  </button>
                  <p>
                    {t(
                      "Medya dönüştürmede FFmpeg kullanılır (LGPL-2.1-or-later). Kaynak kodu, yeniden derleme yönergesi ve lisansları uygulama paketinde bulunur.",
                    )}
                  </p>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() =>
                      window.agentalk
                        .openMediaNotices()
                        .catch((error) => setTestError(error.message))
                    }
                  >
                    <ExternalLink size={13} />
                    {t("FFmpeg kaynak kodu ve lisanslarını aç")}
                  </button>
                </section>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------------
// KARAKTER FORMU MODALI (Bağımsız karakter oluşturma)
// ----------------------------------------------------------------------
function CharacterFormModal({
  state,
  initialConnectionId,
  initialModel,
  busy,
  onClose,
  onConnection,
  onSave,
}: {
  state: Snapshot;
  initialConnectionId?: string;
  initialModel?: string;
  busy: boolean;
  onClose: () => void;
  onConnection: () => void;
  onSave: (data: unknown) => void;
}) {
  const [photo, setPhoto] = useState("");
  const [mediaSupport, setMediaSupport] =
    useState<MediaSupport>(defaultMediaSupport);
  const [kind, setKind] = useState<"api" | "folder">("api");
  const [connectionId, setConnectionId] = useState(
    initialConnectionId || state.connections[0]?.id || "",
  );
  const [color, setColor] = useState(
    colors[state.characters.length % colors.length],
  );
  const [model, setModel] = useState(
    () =>
      initialModel ||
      getSuggestedModelsForConnection(
        state.connections.find((c) => c.id === connectionId),
      )[0] ||
      "",
  );
  const currentConnection = state.connections.find(
    (x) => x.id === connectionId,
  );

  useEffect(() => {
    if (
      !state.connections.some((c) => c.id === connectionId) &&
      state.connections.length
    ) {
      setConnectionId(state.connections[0].id);
      setModel(getSuggestedModelsForConnection(state.connections[0])[0] || "");
    }
  }, [state.connections, connectionId]);

  return (
    <Modal
      title={t("Yeni kişi oluştur")}
      subtitle={t("Kendi kimliği ve bağımsız bağlamı olan yeni bir katılımcı.")}
      onClose={onClose}
      maxWidth="620px"
      className="person-form-modal"
    >
      <form
        className="person-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          onSave({
            name: d.get("name"),
            role: d.get("role"),
            instructions: d.get("instructions"),
            kind,
            photo,
            mediaSupport,
            connectionId: kind === "api" ? connectionId : undefined,
            model: kind === "api" ? d.get("model") : undefined,
            color,
            contextBudget: d.get("contextBudget"),
          });
        }}
      >
        <div className="person-form-content">
          <div className="person-identity">
            <ProfilePhoto value={photo} onChange={setPhoto} tile />
            <div className="person-identity-fields">
              <label className="input-field">
                <span>{t("Karakter adı")}</span>
                <input
                  name="name"
                  aria-label={t("Karakter adı")}
                  required
                  maxLength={60}
                  placeholder={t("Örn. Ada Test")}
                />
              </label>
              <label className="input-field">
                <span>{t("Rol / Bakış açısı")}</span>
                <input
                  name="role"
                  defaultValue={t("Dengeli değerlendirici")}
                  required
                  maxLength={200}
                />
              </label>
            </div>
          </div>
          <PersonColorPicker color={color} onChange={setColor} />

          <label className="input-field">
            <span>{t("Sistem talimatı")}</span>
            <textarea
              name="instructions"
              rows={3}
              required
              defaultValue={t(
                "Fikirleri farklı açılardan değerlendir. Kısa ve somut katkılar sun. Gerektiğinde itiraz et ve uygulanabilir bir alternatif öner.",
              )}
            />
          </label>

          <section
            className="person-connection-section"
            aria-label={t("Bağlantı ve model")}
          >
            <h3>{t("Bağlantı ve model")}</h3>
            <div className="ai-kind-selector">
              <button
                type="button"
                className={kind === "api" ? "selected" : ""}
                aria-pressed={kind === "api"}
                onClick={() => setKind("api")}
              >
                <Cpu size={15} />
                <span>{t("Model karakteri")}</span>
              </button>
              <button
                type="button"
                className={kind === "folder" ? "selected" : ""}
                aria-pressed={kind === "folder"}
                onClick={() => setKind("folder")}
              >
                <Folder size={15} />
                <span>{t("Dış ajan")}</span>
              </button>
            </div>
            {kind === "api" ? (
              state.connections.length ? (
                <div className="connection-model-container">
                  <div className="form-group-grid">
                    <label className="input-field">
                      <span>{t("API bağlantısı")}</span>
                      <select
                        value={connectionId}
                        onChange={(e) => {
                          setConnectionId(e.target.value);
                          setModel(
                            getSuggestedModelsForConnection(
                              state.connections.find(
                                (c) => c.id === e.target.value,
                              ),
                            )[0] || "",
                          );
                        }}
                      >
                        {state.connections.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({getProviderDetails(x).badge})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="input-field">
                      <span>{t("Model kimliği")}</span>
                      <input
                        name="model"
                        aria-label={t("Model kimliği")}
                        required
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        list="models-list-modal"
                        placeholder={t("Sunucunun tam model kimliği")}
                      />
                      <datalist id="models-list-modal">
                        {getSuggestedModelsForConnection(currentConnection).map(
                          (m) => (
                            <option key={m} value={m} />
                          ),
                        )}
                      </datalist>
                    </label>
                  </div>

                  <ModelDiscovery
                    key={connectionId}
                    connection={currentConnection}
                  />
                  <p className="field-hint">
                    {t("Her kişi kendi bağımsız bağlamıyla çalışır.")}
                  </p>
                </div>
              ) : (
                <div className="warning-box">
                  <Link2 size={16} />
                  <div>
                    <p>
                      {t(
                        "Önce bir model sunucusu veya API bağlantısı eklemelisin.",
                      )}
                    </p>
                    <button
                      type="button"
                      className="btn-inline-link"
                      onClick={onConnection}
                    >
                      {t("API bağlantısı ekle")}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className="info-box">
                <Folder size={16} />
                <p>
                  {t(
                    "Katılımcı klasörü ve yerel köprü oluşturulur. Dış süreci ayrıca başlatırsın. Klasör ayrımı süreç sandboxı değildir; güvenilen dış ajanlarla kullan.",
                  )}
                </p>
              </div>
            )}
          </section>

          {kind === "api" && (
            <MediaOptions support={mediaSupport} onSupport={setMediaSupport} />
          )}
        </div>
        <div className="modal-actions-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || (kind === "api" && !connectionId)}
            aria-label={t("Kişiyi oluştur")}
          >
            <Plus size={15} />
            <span>{t("Kişiyi oluştur")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------
// KARAKTER DÜZENLEME MODALI (Bağlantı, Model ve Kimlik Güncelleme)
// ----------------------------------------------------------------------
function CharacterEditModal({
  character,
  connections,
  busy,
  onClose,
  onSave,
  onToggle,
  onClone,
  onExport,
  onArchive,
}: {
  character: Character;
  connections: Connection[];
  busy: boolean;
  onClose: () => void;
  onToggle: () => void;
  onClone: () => void;
  onExport: () => void;
  onArchive: () => void;
  onSave: (data: {
    id: string;
    photo: string;
    name: string;
    role: string;
    instructions: string;
    kind: "api" | "folder";
    connectionId?: string;
    model?: string;
    color: string;
    contextBudget?: number;
    mediaSupport?: MediaSupport;
    mediaOutput?: "text" | "audio" | "image";
  }) => void;
}) {
  const [photo, setPhoto] = useState(character.photo || "");
  const [name, setName] = useState(character.name);
  const [role, setRole] = useState(character.role);
  const [instructions, setInstructions] = useState(character.instructions);
  const [color, setColor] = useState(character.color);
  const [connectionId, setConnectionId] = useState(
    character.connectionId || connections[0]?.id || "",
  );
  const [mediaSupport, setMediaSupport] = useState<MediaSupport>({
    image: character.mediaSupport?.image === "no" ? "no" : "auto",
    audio: character.mediaSupport?.audio === "no" ? "no" : "auto",
    video: character.mediaSupport?.video === "no" ? "no" : "auto",
  });
  const [model, setModel] = useState(character.model || "");
  const [contextBudget, setContextBudget] = useState(
    character.contextBudget || 40000,
  );

  const currentConnection = connections.find((x) => x.id === connectionId);
  const suggestedModels = getSuggestedModelsForConnection(currentConnection);

  return (
    <Modal
      title={t("Kişi bilgileri")}
      subtitle={t('"{v0}" katılımcısının bağlantı, model ve kimlik ayarları.', {
        v0: character.name,
      })}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: character.id,
            photo,
            name: name.trim(),
            role: role.trim(),
            instructions: instructions.trim(),
            kind: character.kind,
            connectionId: character.kind === "api" ? connectionId : undefined,
            model: character.kind === "api" ? model.trim() : undefined,
            color,
            contextBudget,
            mediaSupport,
          });
        }}
      >
        <div className="person-identity">
          <ProfilePhoto value={photo} onChange={setPhoto} tile />
          <div className="person-identity-fields">
            <label className="input-field">
              <span>{t("Karakter adı")}</span>
              <input
                name="name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Örn. Ada, Eleştirmen, Filozof")}
              />
            </label>

            <label className="input-field">
              <span>{t("Rol tanımı")}</span>
              <input
                name="role"
                required
                maxLength={200}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder={t("Örn. Dengeli değerlendirici")}
              />
            </label>
          </div>
        </div>
        <PersonColorPicker color={color} onChange={setColor} />

        <label className="input-field">
          <span>{t("Sistem talimatı")}</span>
          <textarea
            name="instructions"
            rows={3}
            required
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={t("Karakterin rolü ve davranış kuralları")}
          />
        </label>

        {character.kind === "api" ? (
          connections.length ? (
            <div className="connection-model-container">
              <div className="multi-char-info-box">
                <Cpu size={14} />
                <span>
                  <strong>{t("Aynı Bağlantı, Çoklu Karakter:")}</strong>
                  {t(
                    "Bu bağlantıyı kullanan diğer karakterlerle aynı API anahtarını paylaşır; her karakter kendi bağımsız bağlamı, rolü ve talimatıyla çalışır.",
                  )}
                </span>
              </div>

              <div className="form-group-grid">
                <label className="input-field">
                  <span>{t("API bağlantısı")}</span>
                  <select
                    value={connectionId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      setConnectionId(newId);
                      const conn = connections.find((x) => x.id === newId);
                      setModel(getSuggestedModelsForConnection(conn)[0] || "");
                    }}
                  >
                    {connections.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({getProviderDetails(x).badge})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="input-field">
                  <span>{t("Model kimliği")}</span>
                  <input
                    name="model"
                    aria-label={t("Model kimliği")}
                    required
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    list="models-list-edit"
                    placeholder={t("Sunucunun tam model kimliği")}
                  />
                  <datalist id="models-list-edit">
                    {suggestedModels.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </label>
              </div>

              <ModelDiscovery
                key={connectionId}
                connection={currentConnection}
              />
              {/* Hızlı Model Öneri Butonları */}
              {suggestedModels.length > 0 && (
                <div className="model-quick-suggestions">
                  <span className="suggestions-label">
                    <Sparkles size={11} />
                    <span>{t("Bağlantıdan alınan modeller:")}</span>
                  </span>
                  <div className="model-chips-row">
                    {suggestedModels.slice(0, 8).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`model-suggestion-chip ${model === m ? "active" : ""}`}
                        onClick={() => setModel(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="warning-box">
              <Link2 size={16} />
              <p>{t("Mevcut bağlantı bulunamadı. Önce bağlantı ekleyin.")}</p>
            </div>
          )
        ) : (
          <div className="info-box">
            <Folder size={16} />
            <p>
              {t("Dış ajan karakterleri katılımcı kutu klasörünü kullanır.")}
            </p>
          </div>
        )}

        {/* Gelişmiş Ayarlar (Bağlam Bütçesi) */}
        <div className="form-group-grid" style={{ marginTop: "12px" }}>
          <label className="input-field">
            <span>{t("Bağlam Bütçesi (Karakter)")}</span>
            <NumberField
              min={4000}
              max={500000}
              step={1000}
              value={contextBudget}
              onChange={setContextBudget}
            />
            <small className="field-hint">
              {t(
                "Tek bir istekte modele gönderilecek maksimum karakter sınırı.",
              )}
            </small>
          </label>
        </div>

        {character.kind === "api" && (
          <MediaOptions support={mediaSupport} onSupport={setMediaSupport} />
        )}
        <div className="person-management-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={onArchive}
          >
            {character.archived ? t("Arşivden çıkar") : t("Kişiyi arşivle")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy || character.archived}
            onClick={onToggle}
          >
            {character.enabled ? t("Kişiyi duraklat") : t("Kişiyi etkinleştir")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={onClone}
          >
            {t("Kişiyi çoğalt")}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={onExport}
          >
            {t("Şablonu dışa aktar")}
          </button>
        </div>
        <div className="modal-actions-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={
              busy ||
              !name.trim() ||
              (character.kind === "api" && !connectionId)
            }
          >
            <Check size={15} />
            <span>{t("Değişiklikleri Kaydet")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------
// BAĞLANTI FORMU MODALI
// ----------------------------------------------------------------------
function ConnectionFormModal({
  busy,
  onClose,
  onSave,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (data: unknown) => void;
}) {
  const [category, setCategory] = useState<ProviderPreset["category"]>("local");
  const [selectedPresetId, setSelectedPresetId] = useState("ollama");
  const [name, setName] = useState("Ollama");
  const [url, setUrl] = useState("http://127.0.0.1:11434");
  const [kind, setKind] = useState<Connection["kind"]>("local");
  const [adapter, setAdapter] = useState<Connection["adapter"]>("ollama");
  const [concurrency, setConcurrency] = useState(1);
  const [showApiKey, setShowApiKey] = useState(false);
  const activePreset = PROVIDER_PRESETS.find((p) => p.id === selectedPresetId)!;
  const selectPreset = (p: ProviderPreset) => {
    setSelectedPresetId(p.id);
    setName(t(p.name));
    setUrl(p.baseUrl);
    setKind(p.kind);
    setAdapter(p.adapter);
    setConcurrency(p.defaultConcurrency);
    setShowApiKey(false);
  };
  const setAddress = (value: string) => {
    setUrl(value);
    try {
      const address = new URL(value);
      setKind(
        ["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)
          ? "local"
          : address.protocol === "http:"
            ? "network"
            : "cloud",
      );
    } catch {
      /* The required URL field validates before saving. */
    }
  };
  const addressField = (
    <label className="input-field">
      <span>{t("API adresi")}</span>
      <input
        name="baseUrl"
        aria-label={t("Sunucu adresi")}
        type="url"
        required
        value={url}
        onChange={(e) => setAddress(e.target.value)}
        placeholder={
          category === "local" ? "http://127.0.0.1:1234/v1" : "https://…/v1"
        }
      />
    </label>
  );
  return (
    <Modal
      title={t("API bağlantısı ekle")}
      subtitle={t("Bir bulut hizmetine veya yerel model sunucuna bağlan.")}
      onClose={onClose}
      maxWidth="580px"
    >
      <form
        className="api-connection-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          onSave({
            name,
            baseUrl: url,
            kind,
            adapter,
            apiKey: data.get("apiKey"),
            concurrency,
          });
        }}
      >
        <div
          className="segmented-tabs provider-category-tabs"
          aria-label={t("Bağlantı türü")}
        >
          {(["cloud", "local", "custom"] as const).map((type) => (
            <button
              type="button"
              key={type}
              className={category === type ? "active" : ""}
              aria-pressed={category === type}
              onClick={() => {
                setCategory(type);
                selectPreset(
                  PROVIDER_PRESETS.find((p) => p.category === type)!,
                );
              }}
            >
              {type === "cloud" ? (
                <Cloud size={14} />
              ) : type === "local" ? (
                <Laptop size={14} />
              ) : (
                <Server size={14} />
              )}
              {type === "cloud"
                ? t("Bulut")
                : type === "local"
                  ? t("Yerel")
                  : t("Özel")}
            </button>
          ))}
        </div>
        {category !== "custom" && (
          <label className="input-field">
            <span>{t("Sağlayıcı")}</span>
            <select
              aria-label={t("Sağlayıcı")}
              value={selectedPresetId}
              onChange={(e) =>
                selectPreset(
                  PROVIDER_PRESETS.find((p) => p.id === e.target.value)!,
                )
              }
            >
              {PROVIDER_PRESETS.filter((p) => p.category === category).map(
                (p) => (
                  <option key={p.id} value={p.id}>
                    {t(p.name)}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        <label className="input-field">
          <span>{t("Bağlantı adı")}</span>
          <input
            name="name"
            aria-label={t("Bağlantı adı")}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {category !== "cloud" && addressField}
        <label className="input-field">
          <div className="field-label-row">
            <span>
              {kind === "cloud"
                ? t("API anahtarı")
                : t("API anahtarı (isteğe bağlı)")}
            </span>
            {activePreset.portalUrl && (
              <button
                type="button"
                className="key-portal-link"
                aria-label={t("Anahtar al")}
                onClick={() =>
                  window.agentalk.openUrl?.(activePreset.portalUrl!)
                }
              >
                {t("Anahtar al")} <ExternalLink size={12} />
              </button>
            )}
          </div>
          <div className="api-key-input-wrapper">
            <input
              key={selectedPresetId}
              type={showApiKey ? "text" : "password"}
              name="apiKey"
              autoComplete="off"
              placeholder={t(activePreset.placeholder)}
            />
            <button
              type="button"
              className="api-key-toggle-btn"
              onClick={() => setShowApiKey(!showApiKey)}
              aria-label={
                showApiKey ? t("Anahtarı gizle") : t("Anahtarı göster")
              }
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <small className="field-hint">
            {kind !== "cloud"
              ? t("Sunucuda kimlik doğrulama açıksa anahtar gir.")
              : t("Anahtar işletim sisteminin korumalı kasasında şifrelenir.")}
          </small>
        </label>
        <details className="connection-advanced" key={category}>
          <summary>{t("Gelişmiş ayarlar")}</summary>
          <div className="connection-advanced-fields">
            {category === "cloud" && addressField}
            <div className="form-group-grid">
              <label className="input-field">
                <span>{t("Sunucu konumu")}</span>
                <select
                  value={kind}
                  aria-label={t("Sunucu konumu")}
                  onChange={(e) =>
                    setKind(e.target.value as Connection["kind"])
                  }
                >
                  <option value="cloud">{t("Bulut")}</option>
                  <option value="local">{t("Bu bilgisayar")}</option>
                  <option value="network">{t("Ağdaki sunucu")}</option>
                </select>
              </label>
              <label className="input-field">
                <span>{t("API biçimi")}</span>
                <select
                  value={adapter}
                  aria-label={t("API biçimi")}
                  onChange={(e) =>
                    setAdapter(e.target.value as Connection["adapter"])
                  }
                >
                  <option value="compatible">OpenAI Chat Completions</option>
                  <option value="anthropic">Claude Messages</option>
                  <option value="gemini">Gemini generateContent</option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>
            </div>
            <label className="input-field">
              <span>{t("Eşzamanlı istek")}</span>
              <select
                aria-label={t("Eşzamanlı istek")}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        <p className="connection-form-hint">
          {t(
            "Kaydettikten sonra bağlantıyı sına; güncel modeller sunucudan alınır.",
          )}
        </p>
        <div className="modal-actions-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy}
            aria-label={t("Bağlantıyı kaydet")}
          >
            <Link2 size={14} />
            {t("Bağlantıyı kaydet")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------------
// API ANAHTARI GÜNCELLEME MODALI
// ----------------------------------------------------------------------
function UpdateKeyModal({
  connection,
  busy,
  onClose,
  onSave,
}: {
  connection: Connection;
  busy: boolean;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<unknown>;
}) {
  const [showKey, setShowKey] = useState(false);
  const [hasNewKey, setHasNewKey] = useState(false);
  const provider = getProviderDetails(connection);

  return (
    <Modal
      title={t("API Anahtarını Güncelle")}
      subtitle={t("{v0} ({v1}) için kasadaki anahtarı değiştir veya kaldır.", {
        v0: connection.name,
        v1: provider.badge,
      })}
      onClose={onClose}
      maxWidth="480px"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const value = String(new FormData(form).get("apiKey") || "");
          form.reset();
          setHasNewKey(false);
          await onSave(value);
        }}
      >
        <label className="input-field">
          <span>{t("Yeni API Anahtarı")}</span>
          <div className="api-key-input-wrapper">
            <input
              type={showKey ? "text" : "password"}
              name="apiKey"
              onChange={(e) => setHasNewKey(Boolean(e.target.value.trim()))}
              placeholder={
                connection.hasKey
                  ? t("Mevcut anahtarı değiştirmek için yeni anahtar girin")
                  : t("API anahtarını yapıştırın")
              }
              autoComplete="off"
            />
            <button
              type="button"
              className="api-key-toggle-btn"
              onClick={() => setShowKey(!showKey)}
              aria-label={showKey ? t("Anahtarı gizle") : t("Anahtarı göster")}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <small className="field-hint">
            {connection.hasKey
              ? t(
                  "Anahtarı silip anahtarsız kullanmak isterseniz kutuyu boş bırakıp kaydedin.",
                )
              : t(
                  "Anahtar işletim sistemi kasasında şifrelenerek saklanacaktır.",
                )}
          </small>
        </label>

        <div className="vault-security-badge">
          <ShieldCheck size={18} className="shield-icon" />
          <div className="security-text">
            <strong>{t("İşletim sistemi anahtar kasası")}</strong>
            <p>
              {t(
                "Anahtarınız işletim sistemi desteğiyle şifrelenerek saklanır. Mesaj geçmişinde veya export dosyalarında asla yer almaz.",
              )}
            </p>
          </div>
        </div>

        <div className="modal-actions-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("Vazgeç")}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            <Key size={14} />
            <span>
              {hasNewKey
                ? t("Anahtarı Kaydet")
                : connection.hasKey
                  ? t("Anahtarı Temizle")
                  : t("Kaydet")}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
