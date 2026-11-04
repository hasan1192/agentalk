import { useEffect, useRef, useState, type SetStateAction } from "react";
import type { Chat, MediaDraft, Message } from "./types";

export type ComposerEntry = {
  text: string;
  positions: { id: string; position: number }[];
  selection: { start: number; end: number };
  mentions: { id: string; token: string }[];
};
export type ComposerMemory = {
  history: { entries: ComposerEntry[]; index: number; restoring: boolean };
  selection: { start: number; end: number } | null;
  mentions: { id: string; token: string }[];
  caret: number;
  position: number;
  scrollTop: number;
};
type Draft = {
  text: string;
  media: MediaDraft[];
  targets: string[];
  reply: Message | null;
  revision: number;
};
type Resources = {
  chatId: string;
  topicId: string;
  pending: { current: MediaDraft[] };
  retained: { current: Map<string, MediaDraft> };
  insertion: { current: number };
  memory: ComposerMemory;
};
const empty: Draft = {
  text: "",
  media: [],
  targets: [],
  reply: null,
  revision: 0,
};
const freshMemory = (): ComposerMemory => ({
  history: { entries: [], index: -1, restoring: false },
  selection: null,
  mentions: [],
  caret: 0,
  position: 0,
  scrollTop: 0,
});
const discard = (resource: Resources) => {
  for (const id of resource.retained.current.keys())
    void window.agentalk.discardMedia(id).catch(() => {});
  resource.retained.current.clear();
};

// Session-only drafts are scoped to a chat and topic; no content enters preferences or the journal.
export default function useChatDraft(
  chat: Chat | undefined,
  chats: Chat[] | undefined,
) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const resources = useRef(new Map<string, Resources>());
  const key = chat ? `${chat.id}:${chat.topicId}` : "";
  let resource = resources.current.get(key);
  if (!resource) {
    resource = {
      chatId: chat?.id || "",
      topicId: chat?.topicId || "",
      pending: { current: [] },
      retained: { current: new Map() },
      insertion: { current: 0 },
      memory: freshMemory(),
    };
    resources.current.set(key, resource);
  }
  const current = drafts[key] || empty;
  const change =
    <K extends keyof Draft>(field: K) =>
    (value: SetStateAction<Draft[K]>) => {
      // Capture the originating key: an async send must never clear the newly selected chat.
      setDrafts((all) => {
        if (!resources.current.has(key)) return all;
        const previous = all[key] || empty;
        const next =
          typeof value === "function"
            ? (value as (previous: Draft[K]) => Draft[K])(previous[field])
            : value;
        if (Object.is(previous[field], next)) return all;
        return { ...all, [key]: { ...previous, [field]: next } };
      });
    };
  useEffect(() => {
    if (!chats) return;
    const invalid: string[] = [];
    for (const [id, entry] of resources.current) {
      if (
        !chats.some(
          (c) =>
            c.id === entry.chatId && c.topicId === entry.topicId && !c.deleted,
        )
      ) {
        discard(entry);
        resources.current.delete(id);
        invalid.push(id);
      }
    }
    if (invalid.length)
      setDrafts((all) => {
        const remaining = { ...all };
        for (const id of invalid) delete remaining[id];
        return remaining;
      });
  }, [chats]);
  useEffect(
    () => () => {
      for (const entry of resources.current.values()) discard(entry);
      resources.current.clear();
    },
    [],
  );
  return {
    draft: current.text,
    setDraft: change("text"),
    pendingMedia: current.media,
    setPendingMedia: change("media"),
    targetIds: current.targets,
    setTargetIds: change("targets"),
    replyTarget: current.reply,
    setReplyTarget: change("reply"),
    composerRevision: current.revision,
    setComposerRevision: change("revision"),
    pendingMediaRef: resource.pending,
    retainedMedia: resource.retained,
    insertionPosition: resource.insertion,
    composerMemory: resource.memory,
    resetEditorMemory: () => {
      resource.memory = freshMemory();
    },
  };
}
