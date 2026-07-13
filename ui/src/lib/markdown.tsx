import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// hljs stylesheet is mounted by `stores/theme.ts` so it can swap between
// light/dark variants when the user toggles theme.
import { CopyButton } from "../components/CopyButton";
import { useUI } from "../stores/ui";
import { useProjectGateway } from "./project_client";
import { rewriteImageSrc } from "./image_url";
import { looksLikePath, extractPath } from "./looks_like_path";

// Match @-prefixed paths the agent (or user echoes) emits in prose. Conservative
// pattern: bare ASCII filename-ish chars + slashes + dots; must follow start-of-
// string or whitespace so e-mails like foo@bar.com don't match.
const MENTION_RE = /(?:^|(?<=\s))@([\w./-]+(?:\.[A-Za-z0-9]+)?)/g;

function extractText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return extractText(props?.children);
  }
  return "";
}

function renderWithMentions(children: React.ReactNode, projectId: string | null): React.ReactNode {
  // We only rewrite plain strings — leaving nested React nodes alone preserves
  // any other markdown formatting that's already inside them.
  if (typeof children !== "string") return children;
  if (!projectId) return children;
  const text = children;
  MENTION_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const path = m[1];
    // Skip e-mails-looking paths (require at least one slash OR a dot in the
    // basename to qualify as a file mention).
    if (!path.includes("/") && !path.includes(".")) continue;
    const start = m.index + m[0].indexOf("@");
    if (cursor < start) out.push(text.slice(cursor, start));
    out.push(
      <MentionLink key={`mention-${key++}`} projectId={projectId} path={path} />,
    );
    cursor = start + m[0].length - m[0].indexOf("@");
  }
  if (out.length === 0) return text;
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function MentionLink({ projectId, path }: { projectId: string; path: string }) {
  const open = useUI((s) => s.openFileViewer);
  return (
    <button
      type="button"
      onClick={() => open(projectId, path)}
      title={`Open ${path}`}
      className="inline-flex items-baseline px-1 py-0.5 rounded font-mono text-[0.85em] bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900"
    >
      @{path}
    </button>
  );
}

function InlinePathCode({ raw, projectId, children }: { raw: string; projectId: string; children: React.ReactNode }) {
  const open = useUI((s) => s.openFileViewer);
  return (
    <code
      role="button"
      tabIndex={0}
      onClick={() => open(projectId, extractPath(raw))}
      onKeyDown={(e) => { if (e.key === "Enter") open(projectId, extractPath(raw)); }}
      title={`Open ${extractPath(raw)}`}
      className="cursor-pointer underline decoration-dotted decoration-blue-400/70 underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
    >
      {children}
    </code>
  );
}

function makeComponents(
  projectId: string | null,
  imgRewriter: ((src: string) => string) | null,
): Components {
  return {
    // Fenced code blocks: <pre><code class="language-xxx">…</code></pre>. We
    // target <pre> because that's where the full block lives — inline code uses
    // <code> without a parent <pre>, and we don't want a copy button there.
    pre({ children, ...props }) {
      const text = extractText(children).replace(/\n$/, "");
      return (
        <div className="relative group/code">
          <pre {...props}>{children}</pre>
          <span className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
            <CopyButton text={text} title="Copy code" />
          </span>
        </div>
      );
    },
    // Inline code: when the content looks like a project-relative file path
    // and we have a project context, render as a clickable link to the file
    // viewer. Block-level fenced code (which arrives with a `language-*`
    // className) passes through to the default <code> rendering inside <pre>.
    code({ className, children, ...props }) {
      const isBlock = typeof className === "string" && className.startsWith("language-");
      if (isBlock || !projectId) {
        return <code className={className} {...props}>{children}</code>;
      }
      const text = typeof children === "string"
        ? children
        : Array.isArray(children) && children.every((c) => typeof c === "string")
          ? (children as string[]).join("")
          : null;
      if (text && looksLikePath(text)) {
        return <InlinePathCode raw={text} projectId={projectId}>{children}</InlinePathCode>;
      }
      return <code className={className} {...props}>{children}</code>;
    },
    // Inline mentions: hook into <p>, <li>, and <span>-equivalents (<em>/<strong>)
    // since plain text always ends up wrapped in one of these.
    p({ children, ...props }) {
      const arr = Array.isArray(children) ? children : [children];
      return <p {...props}>{arr.map((c, i) => <span key={i}>{renderWithMentions(c, projectId)}</span>)}</p>;
    },
    li({ children, ...props }) {
      const arr = Array.isArray(children) ? children : [children];
      return <li {...props}>{arr.map((c, i) => <span key={i}>{renderWithMentions(c, projectId)}</span>)}</li>;
    },
    // Tables: remark-gfm gives us tables; we add Tailwind classes so they
    // render readable in both modes.
    table({ children, ...props }) {
      return (
        <div className="overflow-x-auto my-2">
          <table {...props} className="text-xs border-collapse border border-gray-300 dark:border-gray-700">
            {children}
          </table>
        </div>
      );
    },
    th({ children, ...props }) {
      return <th {...props} className="border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2 py-1 text-left font-semibold">{children}</th>;
    },
    td({ children, ...props }) {
      return <td {...props} className="border border-gray-300 dark:border-gray-700 px-2 py-1 align-top">{children}</td>;
    },
    // Images: rewrite relative paths to the gateway's /files/serve endpoint
    // when a project context exists. Absolute URLs and data: URIs pass through.
    img({ src, alt, ...props }) {
      const raw = typeof src === "string" ? src : "";
      const finalSrc = imgRewriter ? imgRewriter(raw) : raw;
      return (
        <img
          {...props}
          src={finalSrc}
          alt={alt}
          className="max-w-full h-auto rounded border border-gray-200 dark:border-gray-700 my-2"
          loading="lazy"
        />
      );
    },
  };
}

export function Markdown({ children, projectId = null }: { children: string; projectId?: string | null }) {
  const client = useProjectGateway(projectId);

  const imgRewriter = (raw: string): string =>
    rewriteImageSrc(
      raw,
      projectId && client
        ? { baseUrl: client.baseUrl, bearerToken: client.bearerToken, projectId }
        : null,
    );

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={makeComponents(projectId, projectId ? imgRewriter : null)}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
