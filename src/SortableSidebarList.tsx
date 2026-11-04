import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Layout = { id: string; top: number; height: number };
type Preview = { source: string; layout: Layout[]; ids: string[] };

// Keep the native drag source mounted; animate the other rows into their future slots.
export default function SortableSidebarList<T extends { id: string }>({
  items,
  renderItem,
  onReorder,
  className = "",
}: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  onReorder: (ids: string[]) => Promise<unknown>;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const current = useRef<Preview | null>(null);
  const dropping = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const orderKey = items.map((item) => item.id).join(",");
  const clear = () => {
    current.current = null;
    setPreview(null);
  };
  useLayoutEffect(clear, [orderKey]);

  const gap =
    preview && preview.layout.length > 1
      ? preview.layout[1].top - preview.layout[0].top - preview.layout[0].height
      : 0;
  const positions = new Map<string, number>();
  let top = preview?.layout[0]?.top ?? 0;
  for (const id of preview?.ids ?? []) {
    positions.set(id, top);
    top += (preview?.layout.find((row) => row.id === id)?.height ?? 0) + gap;
  }

  return (
    <div
      ref={list}
      className={`sortable-sidebar-list ${className}`}
      data-dragging={Boolean(preview)}
      onDragOver={(event) => {
        const active = current.current;
        if (!active || dropping.current || !list.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const y = event.clientY - list.current.getBoundingClientRect().top;
        // Compare against fixed destination slots. Transformed rows cannot shift
        // the thresholds under the pointer and cause a jump back and forth.
        const rowGap =
          active.layout.length > 1
            ? active.layout[1].top -
              active.layout[0].top -
              active.layout[0].height
            : 0;
        let slot = active.layout.findIndex(
          (row) => y < row.top + row.height + rowGap / 2,
        );
        if (slot < 0) slot = active.layout.length - 1;
        const ids = active.layout
          .filter((row) => row.id !== active.source)
          .map((row) => row.id);
        ids.splice(slot, 0, active.source);
        if (ids.join(",") !== active.ids.join(",")) {
          const next = { ...active, ids };
          current.current = next;
          setPreview(next);
        }
      }}
      onDrop={async (event) => {
        const active = current.current;
        if (!active) return;
        event.preventDefault();
        dropping.current = true;
        try {
          if (active.ids.join(",") !== orderKey) await onReorder(active.ids);
        } finally {
          dropping.current = false;
          clear();
        }
      }}
    >
      {items.map((item) => {
        const original = preview?.layout.find((row) => row.id === item.id);
        const offset = original
          ? (positions.get(item.id) ?? original.top) - original.top
          : 0;
        return (
          <div
            key={item.id}
            className="sortable-sidebar-row"
            data-sort-id={item.id}
            data-drag-source={preview?.source === item.id}
            style={
              preview ? { transform: `translateY(${offset}px)` } : undefined
            }
            draggable={!dropping.current}
            onDragStart={(event) => {
              if (!list.current) return;
              const base = list.current.getBoundingClientRect().top;
              const layout = Array.from(list.current.children)
                .filter(
                  (node) => node instanceof HTMLElement && node.dataset.sortId,
                )
                .map((node) => {
                  const rect = node.getBoundingClientRect();
                  return {
                    id: (node as HTMLElement).dataset.sortId!,
                    top: rect.top - base,
                    height: rect.height,
                  };
                });
              const next = {
                source: item.id,
                layout,
                ids: layout.map((row) => row.id),
              };
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item.id);
              const sourceBounds = event.currentTarget.getBoundingClientRect();
              event.dataTransfer.setDragImage(
                event.currentTarget,
                event.clientX - sourceBounds.left,
                event.clientY - sourceBounds.top,
              );
              current.current = next;
              setPreview(next);
            }}
            onDragEnd={() => {
              if (!dropping.current) clear();
            }}
          >
            {renderItem(item)}
          </div>
        );
      })}
      {preview && (
        <div
          className="sidebar-drop-line"
          aria-hidden="true"
          style={{
            top: positions.get(preview.source) ?? 0,
            height: preview.layout.find((row) => row.id === preview.source)
              ?.height,
          }}
        />
      )}
    </div>
  );
}
