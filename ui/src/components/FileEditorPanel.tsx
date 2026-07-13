import { useEffect, useRef, useState } from "react";
import { useUI } from "../stores/ui";
import { useProjectGateway } from "../lib/project_client";
import { Markdown } from "../lib/markdown";
import { CopyButton } from "./CopyButton";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"]);
const AUTOSAVE_MS = 800;

export function FileEditorPanel() {
  const viewer = useUI((s) => s.fileViewer);
  const close = useUI((s) => s.closeFileViewer);
  const client = useProjectGateway(viewer?.projectId);

  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<"edit" | "preview">("edit");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (!viewer || !client) {
      setContent("");
      setBaseline("");
      setError(null);
      setBinary(false);
      setTruncated(false);
      setWritable(false);
      setSaveStatus("idle");
      return;
    }
    setRenderMode("edit");
    setLoading(true);
    setError(null);
    setSaveStatus("idle");
    setSaveError(null);
    let cancelled = false;
    (async () => {
      try {
        const p = await client.readProjectFile(viewer.projectId, viewer.path);
        if (cancelled) return;
        setContent(p.content);
        setBaseline(p.content);
        setBinary(p.binary);
        setTruncated(p.truncated);
        setWritable(p.writable);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setContent("");
          setWritable(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [viewer, client]);

  useEffect(() => {
    if (!viewer) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void flushSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, close, writable, baseline]);

  async function flushSave(nextContent?: string) {
    if (!viewer || !client || !writable) return;
    const text = nextContent ?? contentRef.current;
    if (text === baseline) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await client.writeProjectFile(viewer.projectId, viewer.path, text);
      setBaseline(text);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      setSaveError((e as Error).message);
    }
  }

  function onChange(next: string) {
    setContent(next);
    if (!writable) return;
    setSaveStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave(next);
    }, AUTOSAVE_MS);
  }

  if (!viewer) return null;

  const ext = viewer.path.split(".").pop()?.toLowerCase() ?? "";
  const isMarkdown = MARKDOWN_EXTS.has(ext);
  const statusLabel =
    saveStatus === "dirty"
      ? "Unsaved"
      : saveStatus === "saving"
        ? "Saving…"
        : saveStatus === "saved"
          ? "Saved"
          : saveStatus === "error"
            ? "Save failed"
            : "";

  return (
    <div className="h-full flex flex-col border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <span className="text-xs font-mono text-gray-700 dark:text-gray-200 truncate flex-1" title={viewer.path}>
          {viewer.path}
        </span>
        {writable && statusLabel && (
          <span
            className={`text-[10px] shrink-0 ${
              saveStatus === "error"
                ? "text-red-600"
                : saveStatus === "saved"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-gray-400"
            }`}
            title={saveError ?? undefined}
          >
            {statusLabel}
          </span>
        )}
        {isMarkdown && writable && (
          <button
            type="button"
            onClick={() => setRenderMode((m) => (m === "edit" ? "preview" : "edit"))}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            {renderMode === "edit" ? "Preview" : "Edit"}
          </button>
        )}
        <CopyButton text={viewer.path} title="Copy file path" label="Path" />
        <button
          type="button"
          onClick={close}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none shrink-0 px-1"
          aria-label="Close file panel"
        >
          ×
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading && <p className="p-3 text-xs text-gray-400">Loading…</p>}
        {error && <p className="p-3 text-xs text-red-600">{error}</p>}
        {!loading && !error && binary && (
          <p className="p-3 text-xs text-gray-500">Binary file — cannot edit in panel.</p>
        )}
        {!loading && !error && truncated && !binary && (
          <p className="p-3 text-xs text-amber-600">
            File exceeds 2 MB edit limit — open externally to edit the full file.
          </p>
        )}
        {!loading && !error && !binary && writable && renderMode === "edit" && (
          <textarea
            value={content}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="w-full h-full resize-none border-0 outline-none px-3 py-2 text-xs font-mono leading-5 bg-transparent text-gray-800 dark:text-gray-100"
          />
        )}
        {!loading && !error && !binary && (!writable || renderMode === "preview") && (
          <div className="h-full overflow-auto px-3 py-2 text-xs">
            {isMarkdown && renderMode === "preview" ? (
              <Markdown projectId={viewer.projectId}>{content}</Markdown>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-gray-800 dark:text-gray-100">{content}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
