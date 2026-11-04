import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import MediaToken from "./MediaToken";
import { messagePieces } from "./message-layout.mjs";
import {
  readEditor,
  editorCaret,
  editorSelection,
  selectEditor,
} from "./composer-dom";
import type { Character, MediaDraft } from "./types";
import type { ComposerMemory } from "./useChatDraft";
import { t } from "./i18n";

const containsMention = (draft: string, token: string) => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?=$|\\s|[.,!?;:])`, "u").test(draft);
};
type Unit = string | { id: string };
const editorUnits = (value: ReturnType<typeof readEditor>) => {
  const units: Unit[] = [];
  let at = 0;
  for (const p of value.positions) {
    units.push(...value.text.slice(at, p.position).split(""), { id: p.id });
    at = p.position;
  }
  units.push(...value.text.slice(at).split(""));
  return units;
};

export default function MentionComposer({
  draft,
  onDraft,
  participants,
  group,
  onTargets,
  onSend,
  media,
  onMediaPositions,
  onRemoveMedia,
  onCaret,
  onRetainMedia,
  memory,
}: {
  draft: string;
  onDraft: (value: string) => void;
  participants: Character[];
  group: boolean;
  onTargets: (ids: string[]) => void;
  onSend: () => void;
  media: MediaDraft[];
  onMediaPositions: (positions: { id: string; position: number }[]) => void;
  onRemoveMedia: (id: string) => void;
  onCaret: (position: number) => void;
  onRetainMedia: (ids: Set<string>) => void;
  memory: ComposerMemory;
}) {
  const input = useRef<HTMLDivElement>(null);
  const caret = useRef(memory.caret);
  const dragging = useRef<string | null>(null);
  const [mounts, setMounts] = useState<Map<string, HTMLElement>>(new Map());
  const history = useRef(memory.history);
  const nextSelection = useRef(memory.selection);
  const signature = JSON.stringify([
    draft,
    media.map((m) => [m.id, m.position ?? draft.length]),
  ]);
  useLayoutEffect(() => {
    const root = input.current;
    if (!root) return;
    const current = readEditor(root);
    const h = history.current;
    if (h.restoring) h.restoring = false;
    else if (
      JSON.stringify([
        h.entries[h.index]?.text,
        h.entries[h.index]?.positions.map((p) => [p.id, p.position]),
      ]) !== signature
    ) {
      h.entries.splice(h.index + 1);
      h.entries.push({
        text: draft,
        positions: media.map((m) => ({
          id: m.id,
          position: m.position ?? draft.length,
        })),
        selection: editorSelection(root) || {
          start: caret.current,
          end: caret.current,
        },
        mentions: selected,
      });
      if (h.entries.length > 100) h.entries.shift();
      h.index = h.entries.length - 1;
    }
    onRetainMedia(
      new Set(h.entries.flatMap((entry) => entry.positions.map((p) => p.id))),
    );
    if (
      !nextSelection.current &&
      JSON.stringify([
        current.text,
        current.positions.map((p) => [p.id, p.position]),
      ]) === signature
    )
      return;
    const previousIds = new Set(current.positions.map((p) => p.id));
    const fragment = document.createDocumentFragment(),
      nodes = new Map<string, HTMLElement>();
    let logical = 0,
      addedCaret: number | null = null;
    for (const piece of messagePieces(draft, media)) {
      if (piece.type === "text") {
        for (const [index, line] of piece.text.split("\n").entries()) {
          if (index) fragment.append(document.createElement("br"));
          if (line) fragment.append(document.createTextNode(line));
        }
        logical += piece.text.length;
      } else {
        const node = document.createElement("span");
        node.contentEditable = "false";
        node.draggable = true;
        node.dataset.attachmentId = piece.attachment.id;
        node.className = `composer-media-chip ${piece.attachment.kind}`;
        fragment.append(node);
        nodes.set(piece.attachment.id, node);
        logical++;
        if (!previousIds.has(piece.attachment.id)) addedCaret = logical;
      }
    }
    // An empty trailing text node gives the caret a place after an atomic file.
    fragment.append(document.createTextNode(""));
    if (draft.endsWith("\n") && fragment.lastElementChild?.tagName === "BR") {
      const placeholder = document.createElement("br");
      placeholder.dataset.composerPlaceholder = "true";
      fragment.append(placeholder);
    }
    root.replaceChildren(fragment);
    setMounts(nodes);
    caret.current = Math.min(
      nextSelection.current?.start ?? addedCaret ?? caret.current,
      logical,
    );
    if (document.activeElement === root || addedCaret !== null) {
      root.focus();
      selectEditor(
        root,
        caret.current,
        nextSelection.current?.end ?? caret.current,
      );
    }
    nextSelection.current = null;
    const entry = h.entries[h.index];
    if (entry) entry.selection = editorSelection(root) || entry.selection;
    captureCaret();
  }, [signature]);
  useLayoutEffect(() => {
    if (input.current) input.current.scrollTop = memory.scrollTop;
  }, [mounts]);
  const captureCaret = () => {
    const value = input.current && editorCaret(input.current);
    if (!value) return;
    caret.current = value.logical;
    setCursor(value.position);
    onCaret(value.position);
    memory.caret = value.logical;
    memory.position = value.position;
    memory.selection = input.current && editorSelection(input.current);
    const entry = history.current.entries[history.current.index];
    if (entry && input.current)
      entry.selection = editorSelection(input.current) || entry.selection;
  };
  const restore = (direction: number) => {
    const h = history.current,
      index = h.index + direction;
    const entry = h.entries[index];
    if (!entry) return;
    h.index = index;
    h.restoring = true;
    nextSelection.current = entry.selection;
    onDraft(entry.text);
    onMediaPositions(entry.positions);
    setSelected(entry.mentions);
  };
  // Own the history of atomic attachments; Chromium's DOM undo cannot restore React portals.
  useEffect(() => {
    const root = input.current;
    if (!root) return;
    const before = (event: InputEvent) => {
      if (
        !event.isComposing &&
        event.inputType === "insertText" &&
        event.data !== null
      ) {
        event.preventDefault();
        insertText(event.data);
        return;
      }
      if (
        !event.isComposing &&
        ["insertLineBreak", "insertParagraph"].includes(event.inputType)
      ) {
        event.preventDefault();
        insertText("\n");
        return;
      }
      if (
        event.inputType === "historyUndo" ||
        event.inputType === "historyRedo"
      ) {
        event.preventDefault();
        restore(event.inputType === "historyUndo" ? -1 : 1);
      }
    };
    root.addEventListener("beforeinput", before);
    return () => root.removeEventListener("beforeinput", before);
  });
  const commitUnits = (units: Unit[], caret: number) => {
    let text = "";
    const positions: { id: string; position: number }[] = [];
    for (const unit of units) {
      if (typeof unit === "string") text += unit;
      else positions.push({ id: unit.id, position: text.length });
    }
    nextSelection.current = { start: caret, end: caret };
    onDraft(text);
    onMediaPositions(positions);
  };
  const deleteAtomic = (backward: boolean) => {
    const root = input.current,
      range = root && editorSelection(root);
    if (!root || !range) return false;
    const units = editorUnits(readEditor(root));
    let { start, end } = range;
    if (start === end) {
      const index = backward ? start - 1 : end;
      if (typeof units[index] !== "object") return false;
      start = index;
      end = index + 1;
    } else if (
      !units.slice(start, end).some((unit) => typeof unit === "object")
    )
      return false;
    units.splice(start, end - start);
    commitUnits(units, start);
    return true;
  };
  const changed = () => {
    if (!input.current) return;
    const value = readEditor(input.current);
    onDraft(value.text);
    onMediaPositions(value.positions);
    captureCaret();
    setIndex(0);
    setDismissed(false);
  };
  const insertText = (text: string) => {
    const root = input.current;
    if (!root) return;
    const value = readEditor(root),
      selection = editorSelection(root) || {
        start: value.logical,
        end: value.logical,
      };
    const range = {
      start: Math.min(value.logical, selection.start),
      end: Math.min(value.logical, selection.end),
    };
    captureCaret();
    const units = editorUnits(value),
      inserted = text.replace(/\r\n?/g, "\n");
    units.splice(range.start, range.end - range.start, ...inserted.split(""));
    commitUnits(units, range.start + inserted.length);
    setIndex(0);
    setDismissed(false);
  };
  const [cursor, setCursor] = useState(memory.position);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(memory.mentions);
  useEffect(() => {
    memory.mentions = selected;
  }, [selected, memory]);
  const active = selected.filter(
    (item) =>
      participants.some((p) => p.id === item.id && !p.archived && !p.deleted) &&
      containsMention(draft, item.token),
  );
  const candidate =
    group && !dismissed
      ? draft.slice(0, cursor).match(/(?:^|\s)@([^@\n]*)$/u)
      : null;
  const mentionStart = candidate ? cursor - candidate[1].length - 1 : -1;
  const alreadySelected = selected.some((item) =>
    draft.slice(mentionStart, cursor).startsWith(item.token + " "),
  );
  const match = alreadySelected ? null : candidate;
  const query =
    match?.[1].toLocaleLowerCase(document.documentElement.lang).trim() ?? "";
  const options = match
    ? participants.filter(
        (p) =>
          !p.archived &&
          p.name
            .toLocaleLowerCase(document.documentElement.lang)
            .includes(query),
      )
    : [];
  useEffect(() => {
    onTargets(group ? [...new Set(active.map((item) => item.id))] : []);
  }, [draft, group, selected, participants.map((p) => p.id).join(",")]);
  useEffect(() => {
    if (!draft) {
      setSelected([]);
      setCursor(0);
    }
  }, [draft]);
  const choose = (person: Character) => {
    if (!match) return;
    const duplicate =
      participants.filter((p) => p.name === person.name).length > 1;
    const token = `@${person.name}${duplicate ? `#${person.id.slice(0, 6)}` : ""}`;
    const start = caret.current - match[1].length - 1;
    input.current?.focus();
    if (input.current) selectEditor(input.current, start, caret.current);
    insertText(token + " ");
    setSelected((items) => [
      ...items.filter((item) => item.id !== person.id),
      { id: person.id, token },
    ]);
    setDismissed(true);
  };
  return (
    <div className="mention-editor">
      {group && active.length > 0 && (
        <div className="mention-targets">
          {active.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => {
                onDraft(draft.split(item.token).join(""));
                onMediaPositions(
                  media.map((m) => ({
                    id: m.id,
                    position: draft
                      .slice(0, m.position ?? draft.length)
                      .split(item.token)
                      .join("").length,
                  })),
                );
                setSelected((items) => items.filter((i) => i.id !== item.id));
              }}
              aria-label={t("{name} etiketini kaldır", {
                name: participants.find((p) => p.id === item.id)?.name,
              })}
            >
              {item.token} <span>×</span>
            </button>
          ))}
        </div>
      )}
      {match && (
        <div
          className="mention-suggestions"
          role="listbox"
          id="mention-options"
          aria-label={t("Kişi etiketle")}
        >
          {options.map((p, i) => (
            <button
              type="button"
              role="option"
              id={`mention-option-${i}`}
              aria-selected={i === index % options.length}
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
            >
              {p.photo && <img src={p.photo} alt="" />}
              <strong>{p.name}</strong>
              <small>{p.role}</small>
            </button>
          ))}
          {!options.length && <p>{t("Eşleşen kişi yok.")}</p>}
        </div>
      )}
      <div
        ref={input}
        id="composer-textarea"
        className="composer-rich-input"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t("Mesajın")}
        data-placeholder={
          group ? t("Mesaj gönder veya @etiketle…") : t("Mesaj gönder…")
        }
        data-empty={!draft && !media.length}
        aria-controls={match ? "mention-options" : undefined}
        aria-expanded={Boolean(match)}
        aria-autocomplete={group ? "list" : "none"}
        aria-activedescendant={
          options.length
            ? `mention-option-${index % options.length}`
            : undefined
        }
        onInput={changed}
        onScroll={(e) => {
          memory.scrollTop = e.currentTarget.scrollTop;
        }}
        onClick={() => {
          captureCaret();
          setDismissed(false);
        }}
        onKeyUp={captureCaret}
        onBlur={captureCaret}
        onPaste={(e) => {
          if (e.clipboardData.files.length) return;
          e.preventDefault();
          insertText(e.clipboardData.getData("text/plain"));
        }}
        onDragStart={(e) => {
          const node = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-attachment-id]",
          );
          if (!node) return;
          dragging.current = node.dataset.attachmentId!;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData(
            "application/x-agentalk-draft",
            dragging.current,
          );
        }}
        onDragOver={(e) => {
          if (dragging.current) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(e) => {
          if (!dragging.current) {
            if (e.dataTransfer.files.length && input.current) {
              const range = document.caretRangeFromPoint(e.clientX, e.clientY);
              if (range && input.current.contains(range.startContainer)) {
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
                captureCaret();
              }
            }
            return;
          }
          if (!input.current) return;
          e.preventDefault();
          e.stopPropagation();
          const range = document.caretRangeFromPoint(e.clientX, e.clientY);
          const node = input.current.querySelector<HTMLElement>(
            `[data-attachment-id="${dragging.current}"]`,
          );
          if (
            range &&
            node &&
            input.current.contains(range.startContainer) &&
            !node.contains(range.startContainer)
          ) {
            node.remove();
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            changed();
          }
          dragging.current = null;
        }}
        onDragEnd={() => {
          dragging.current = null;
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (
            (e.metaKey || e.ctrlKey) &&
            ["z", "y"].includes(e.key.toLowerCase())
          ) {
            e.preventDefault();
            restore(e.key.toLowerCase() === "y" || e.shiftKey ? 1 : -1);
            return;
          }
          if (
            (e.key === "Backspace" || e.key === "Delete") &&
            deleteAtomic(e.key === "Backspace")
          ) {
            e.preventDefault();
            return;
          }
          if (
            match &&
            options.length &&
            ["ArrowDown", "ArrowUp"].includes(e.key)
          ) {
            e.preventDefault();
            setIndex(
              (i) =>
                (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) %
                options.length,
            );
            return;
          }
          if (
            match &&
            options.length &&
            ["Enter", "Tab"].includes(e.key) &&
            !e.shiftKey
          ) {
            e.preventDefault();
            choose(options[index % options.length]);
            return;
          }
          if (match && e.key === "Escape") {
            e.preventDefault();
            setDismissed(true);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) insertText("\n");
            else onSend();
          }
        }}
      />
      {media.map((m) =>
        mounts.has(m.id)
          ? createPortal(
              <>
                <MediaToken media={m} url={m.url} draft={m} />
                <button
                  type="button"
                  className="composer-media-remove"
                  aria-label={t("Medyayı kaldır")}
                  onKeyDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    input.current?.focus();
                    onRemoveMedia(m.id);
                  }}
                >
                  <X size={14} />
                </button>
              </>,
              mounts.get(m.id)!,
              m.id,
            )
          : null,
      )}
    </div>
  );
}
