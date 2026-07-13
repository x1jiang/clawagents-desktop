import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  /** Storage key — used to persist width per panel id. */
  storageKey: string;
  /** Initial width if nothing is persisted yet. */
  defaultWidth: number;
  /** Minimum width — narrower drags clamp here. */
  minWidth?: number;
  /** Maximum width — wider drags clamp here. */
  maxWidth?: number;
  /** Which edge has the drag handle. */
  edge: "left" | "right";
  children: ReactNode;
}

/**
 * Wrapper that gives any side panel a draggable resize handle on its
 * inside-facing edge. Width persists per `storageKey` in localStorage so
 * the user's layout choices survive reloads.
 */
export function ResizableSide({
  storageKey,
  defaultWidth,
  minWidth = 160,
  maxWidth = 600,
  edge,
  children,
}: Props) {
  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= minWidth && n <= maxWidth) return n;
      }
    } catch { /* ignore */ }
    return defaultWidth;
  });
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent): void {
      if (!dragRef.current) return;
      e.preventDefault();
      const delta = e.clientX - dragRef.current.startX;
      // Left-edge handle (panel on the right) shrinks when the mouse moves
      // right; right-edge handle (panel on the left) grows when it does.
      const next = edge === "left"
        ? dragRef.current.startW - delta
        : dragRef.current.startW + delta;
      setWidth(Math.max(minWidth, Math.min(maxWidth, next)));
    }
    function onUp(): void {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      try { window.localStorage.setItem(storageKey, String(width)); }
      catch { /* ignore */ }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width, minWidth, maxWidth, storageKey, edge]);

  function startDrag(e: React.MouseEvent): void {
    dragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  }

  return (
    <div className="relative shrink-0" style={{ width: `${width}px` }}>
      {edge === "left" && (
        <div
          onMouseDown={startDrag}
          title="Drag to resize"
          className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/60 z-10"
        />
      )}
      {children}
      {edge === "right" && (
        <div
          onMouseDown={startDrag}
          title="Drag to resize"
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/60 z-10"
        />
      )}
    </div>
  );
}
