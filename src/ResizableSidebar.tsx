import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { t } from "./i18n";

const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 220;
const MAX_WIDTH = 460;
const STORAGE_KEY = "agentalk_sidebar_width";
// 320 / .85 rounded up, plus the largest gutters and scrollbar allowance.
const MIN_CONVERSATION_WIDTH = 440;
const maximumWidth = () =>
  Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, window.innerWidth - MIN_CONVERSATION_WIDTH),
  );

export default function ResizableSidebar({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH
      ? saved
      : DEFAULT_WIDTH;
  });
  const [maximum, setMaximum] = useState(maximumWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{
    pointer: number;
    start: number;
    width: number;
    current: number;
  } | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  const actualWidth = Math.min(width, maximum);
  const clamp = (value: number) =>
    Math.round(Math.max(MIN_WIDTH, Math.min(maximumWidth(), value)));
  const saveWidth = (value: number) => {
    setWidth(value);
    localStorage.setItem(STORAGE_KEY, String(value));
  };
  const finish = (cancelled = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (cancelled) setWidth(current.width);
    else saveWidth(current.current);
    if (handle.current?.hasPointerCapture(current.pointer))
      handle.current.releasePointerCapture(current.pointer);
    setResizing(false);
  };
  useEffect(() => {
    const onResize = () => setMaximum(maximumWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (!resizing) return;
    document.documentElement.dataset.sidebarResizing = "true";
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(true);
      }
    };
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", finishCancelled);
    function finishCancelled() {
      finish(true);
    }
    return () => {
      delete document.documentElement.dataset.sidebarResizing;
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", finishCancelled);
    };
  }, [resizing]);
  useEffect(() => {
    if (collapsed) finish(true);
  }, [collapsed]);

  return (
    <aside
      id="workspace-sidebar"
      className={`sidebar ${collapsed ? "collapsed" : ""}`}
      data-resizing={resizing}
      style={{ "--sidebar-width": `${actualWidth}px` } as CSSProperties}
    >
      {children}
      <div
        ref={handle}
        className="sidebar-resize-handle"
        role="separator"
        aria-label={t("Sol paneli boyutlandır")}
        aria-orientation="vertical"
        aria-controls="workspace-sidebar"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maximum}
        aria-valuenow={actualWidth}
        aria-hidden={collapsed}
        tabIndex={collapsed ? -1 : 0}
        title={t(
          "Genişliği sürükleyerek veya ok tuşlarıyla ayarla. Varsayılana dönmek için çift tıkla.",
        )}
        onPointerDown={(event) => {
          if (collapsed || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            start: event.clientX,
            width,
            current: actualWidth,
          };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          current.current = clamp(
            Math.min(current.width, maximum) + event.clientX - current.start,
          );
          setWidth(current.current);
        }}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish(true)}
        onDoubleClick={() => saveWidth(clamp(DEFAULT_WIDTH))}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 16;
          const next =
            event.key === "ArrowLeft"
              ? actualWidth - step
              : event.key === "ArrowRight"
                ? actualWidth + step
                : event.key === "Home"
                  ? MIN_WIDTH
                  : event.key === "End"
                    ? maximum
                    : null;
          if (next !== null) {
            event.preventDefault();
            saveWidth(clamp(next));
          }
        }}
      />
    </aside>
  );
}
