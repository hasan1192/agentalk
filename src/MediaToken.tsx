import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FileText, Image, Maximize2, Music, Video, X } from "lucide-react";
import { MediaPlayer, mediaLabel, mediaSize } from "./MediaContent";
import type { MediaAttachment, MediaDraft } from "./types";
import { t } from "./i18n";

export type MediaSelection = {
  media: MediaAttachment;
  url: string;
  draft?: MediaDraft;
  focusTarget?: HTMLElement;
};
export const MediaOpenContext = createContext<(value: MediaSelection) => void>(
  () => {},
);
const hoverOwners = new Set<(activeId: string) => void>();
export function MediaKindIcon({ kind }: { kind: MediaAttachment["kind"] }) {
  const Icon = { image: Image, audio: Music, video: Video, document: FileText }[
    kind
  ];
  return <Icon size={14} aria-hidden="true" />;
}
export default function MediaToken({ media, url, draft }: MediaSelection) {
  const open = useContext(MediaOpenContext);
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hover, setHover] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();
  const close = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(false), 220);
  };
  const keep = () => {
    for (const notify of hoverOwners) notify(id);
    clearTimeout(timer.current);
    setHover(true);
  };
  const expand = () => {
    setHover(false);
    open({ media, url, draft, focusTarget: anchor.current || undefined });
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const notify = (activeId: string) => {
      if (activeId !== id) {
        clearTimeout(timer.current);
        setHover(false);
      }
    };
    hoverOwners.add(notify);
    return () => {
      hoverOwners.delete(notify);
    };
  }, [id]);
  useLayoutEffect(() => {
    if (!hover) return;
    let anchorBounds: DOMRect | undefined;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect(),
        p = popup.current?.getBoundingClientRect();
      if (!a || !p) return;
      anchorBounds = a;
      setPosition({
        left: Math.max(12, Math.min(a.left, innerWidth - p.width - 12)),
        top: Math.max(12, a.top - p.height - 6),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (popup.current) observer.observe(popup.current);
    const onScroll = (event: Event) => {
      if (popup.current?.contains(event.target as Node)) return;
      const bounds = anchor.current?.getBoundingClientRect();
      // Scrolling history behind a stationary composer must not dismiss its preview.
      if (
        !bounds ||
        !anchorBounds ||
        Math.abs(bounds.top - anchorBounds.top) > 1 ||
        Math.abs(bounds.left - anchorBounds.left) > 1
      )
        setHover(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [hover]);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="media-token"
        title={media.name}
        aria-label={t("{name} önizlemesini aç", { name: media.name })}
        aria-haspopup="dialog"
        aria-expanded={hover}
        aria-controls={hover ? id : undefined}
        onMouseEnter={keep}
        onMouseLeave={close}
        onFocus={keep}
        onBlur={(e) => {
          if (!popup.current?.contains(e.relatedTarget as Node)) close();
        }}
        onClick={expand}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.stopPropagation();
            setHover(false);
          }
        }}
      >
        <MediaKindIcon kind={media.kind} />
        <span>{media.name}</span>
      </button>
      {hover &&
        createPortal(
          <div
            ref={popup}
            id={id}
            className="media-hover-preview"
            role="dialog"
            aria-label={t("{name} önizlemesi", { name: media.name })}
            style={position}
            onClick={(e) => {
              e.stopPropagation();
              if (!(e.target as HTMLElement).closest("audio,video,button"))
                expand();
            }}
            onMouseEnter={keep}
            onMouseLeave={close}
            onFocus={keep}
            onBlur={(e) => {
              if (
                !e.currentTarget.contains(e.relatedTarget as Node) &&
                e.relatedTarget !== anchor.current
              )
                close();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.stopPropagation();
                setHover(false);
              }
            }}
          >
            {media.kind === "audio" || media.kind === "video" ? (
              <div className="media-hover-player">
                <MediaPlayer media={media} url={url} />
              </div>
            ) : (
              <button
                type="button"
                className="media-hover-stage"
                onClick={expand}
                aria-label={t("Önizlemeyi büyüt")}
              >
                <MediaPlayer media={media} url={url} />
              </button>
            )}
            <div className="media-hover-caption">
              <div>
                <strong title={media.name}>{media.name}</strong>
                <small>
                  {mediaLabel(media.kind)} · {mediaSize(media.bytes)}
                </small>
              </div>
              <button
                type="button"
                onClick={expand}
                aria-label={t("Önizlemeyi büyüt")}
              >
                <Maximize2 size={17} />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function MediaDetail({
  selection,
  onClose,
  children,
}: {
  selection: MediaSelection;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous =
      selection.focusTarget || (document.activeElement as HTMLElement | null);
    panel.current?.focus();
    const parent = panel.current?.parentElement;
    const others = parent
      ? ([...parent.children].filter(
          (el) => el !== panel.current,
        ) as HTMLElement[])
      : [];
    const states = others.map((el) => el.inert);
    others.forEach((el) => {
      el.inert = true;
    });
    return () => {
      others.forEach((el, i) => {
        el.inert = states[i];
      });
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      ref={panel}
      className="media-detail-panel"
      role="dialog"
      aria-modal="true"
      aria-label={t("Medya önizlemesi")}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Tab" && panel.current) {
          const controls = [
            ...panel.current.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href],audio[controls],video[controls]",
            ),
          ].filter((el) => el.getClientRects().length);
          const first = controls[0],
            last = controls.at(-1);
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === panel.current)
          ) {
            e.preventDefault();
            last?.focus();
          } else if (
            !e.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === panel.current)
          ) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="media-detail-header">
        <div>
          <strong>{t("Medya önizlemesi")}</strong>
          <span title={selection.media.name}>{selection.media.name}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={t("Kapat")}
        >
          <X size={18} />
        </button>
      </header>
      {children || (
        <div className={`media-detail-view ${selection.media.kind}`}>
          <MediaPlayer media={selection.media} url={selection.url} />
          <p>
            {mediaLabel(selection.media.kind)} ·{" "}
            {mediaSize(selection.media.bytes)}
          </p>
        </div>
      )}
    </div>
  );
}
