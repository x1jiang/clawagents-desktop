import type { Chat } from "../stores/chats";
import type { Project } from "./gateway";
import type { GatewayInfo } from "./tauri";

const MOCK_PREFIX = "/__clawagents_mock_gateway";
const TOKEN = "dev-mock-token";

let installed = false;

const now = new Date().toISOString();

interface MockAttachmentUpload {
  filename?: string;
  mime_type?: string;
  data_base64?: string;
}

const projects: Project[] = [
  {
    id: "demo-project",
    name: "Demo Project",
    root_path: "/tmp/clawagents-demo",
    default_model: "gpt-5.4-mini",
    default_mode: "auto",
    system_prompt: null,
    env_vars: null,
    pinned: true,
    created_at: now,
    last_used_at: now,
    kind: "local",
    ssh_host: null,
    remote_path: null,
  },
];

const projectChats: Chat[] = [
  {
    id: "demo-chat",
    project_id: "demo-project",
    title: "Review UI polish",
    model: "gpt-5.4-mini",
    mode: "auto",
    pinned: true,
    created_at: now,
    last_message_at: now,
    status: "idle",
  },
];

const projectlessChats: Chat[] = [
  {
    id: "scratch-chat",
    project_id: null,
    title: "Scratchpad",
    model: "gpt-5.4-mini",
    mode: "auto",
    created_at: now,
    last_message_at: now,
    status: "idle",
  },
];

const attachmentsByChat: Record<string, Array<Record<string, unknown> & { data_base64: string }>> = {};

function publicAttachment(attachment: Record<string, unknown> & { data_base64: string }): Record<string, unknown> {
  const { data_base64, ...copy } = attachment;
  void data_base64;
  return copy;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function allChats(): Chat[] {
  return [...projectChats, ...projectlessChats];
}

function decodeBase64Text(value: string): string {
  try {
    return decodeURIComponent(escape(window.atob(value)));
  } catch {
    try { return window.atob(value); } catch { return ""; }
  }
}

function base64Size(value: string): number {
  return Math.floor((value.length * 3) / 4);
}

function attachmentKind(filename: string, mimeType: string): string {
  const lower = filename.toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "word";
  if (lower.endsWith(".xlsx")) return "spreadsheet";
  if (lower.endsWith(".pptx")) return "presentation";
  return "text";
}

function route(path: string, method: string, body: unknown): Response {
  if (path === "/health") return json({ ok: true });
  if (path === "/projects" && method === "GET") return json(projects);
  if (path === "/projects" && method === "POST") return json(projects[0], 201);
  if (path === "/projects/demo-project" && method === "PATCH") {
    Object.assign(projects[0], body);
    return json(projects[0]);
  }
  if (path === "/projects/demo-project/chats" && method === "GET") return json(projectChats);
  if (path === "/projects/demo-project/chats" && method === "POST") return json({ chat_id: "demo-chat" }, 201);
  if (path === "/chats" && method === "GET") return json(projectlessChats);
  if (path === "/chats" && method === "POST") return json({ chat_id: "scratch-chat" }, 201);

  const chat = allChats().find((entry) => path === `/chats/${entry.id}`);
  if (chat && method === "GET") return json(chat);
  if (chat && method === "PATCH") {
    Object.assign(chat, body);
    return json(chat);
  }
  const attachmentMatch = path.match(/^\/chats\/([^/]+)\/attachments$/);
  if (attachmentMatch && method === "GET") {
    const chatAttachments = attachmentsByChat[attachmentMatch[1]] ?? [];
    return json(chatAttachments.map(publicAttachment));
  }
  if (attachmentMatch && method === "POST") {
    const upload = body as MockAttachmentUpload | null;
    const filename = upload?.filename || "attachment";
    const mimeType = upload?.mime_type || "application/octet-stream";
    const data = upload?.data_base64 || "";
    const kind = attachmentKind(filename, mimeType);
    const textPreview = kind === "text" ? decodeBase64Text(data).slice(0, 24_000) : `${filename} uploaded for analysis.`;
    const attachment = {
      id: `mock-${Date.now()}`,
      filename,
      mime_type: mimeType,
      size: base64Size(data),
      path: `/mock-uploads/${attachmentMatch[1]}/${filename}`,
      kind,
      text_preview: textPreview,
      text_truncated: false,
      checksum: `sha256:mock-${data.length}`,
      chunks_count: textPreview ? 1 : 0,
      warnings: kind === "image" ? [`vision reference: ![${filename}](/mock-uploads/${attachmentMatch[1]}/${filename})`] : [],
      created_at: Date.now() / 1000,
      deduped: false,
      data_base64: data,
    };
    attachmentsByChat[attachmentMatch[1]] = [...(attachmentsByChat[attachmentMatch[1]] ?? []), attachment];
    return json(publicAttachment(attachment), 201);
  }
  const attachmentDownloadMatch = path.match(/^\/chats\/([^/]+)\/attachments\/([^/]+)\/download$/);
  if (attachmentDownloadMatch && method === "GET") {
    const attachment = (attachmentsByChat[attachmentDownloadMatch[1]] ?? []).find((item) => item.id === attachmentDownloadMatch[2]);
    if (!attachment) return json({ error: "not found" }, 404);
    return new Response(window.atob(attachment.data_base64), {
      headers: { "Content-Type": String(attachment.mime_type ?? "application/octet-stream") },
    });
  }
  const attachmentItemMatch = path.match(/^\/chats\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachmentItemMatch && method === "DELETE") {
    attachmentsByChat[attachmentItemMatch[1]] = (attachmentsByChat[attachmentItemMatch[1]] ?? []).filter((item) => item.id !== attachmentItemMatch[2]);
    return json({ ok: true });
  }
  if (path.match(/^\/chats\/[^/]+\/attachments\/search$/) && method === "POST") {
    return json({ chunks: [] });
  }
  if (path.match(/^\/chats\/[^/]+\/messages$/)) return json([]);
  if (path.match(/^\/chats\/[^/]+\/events/)) return json([]);

  if (path === "/commands") return json([]);
  if (path === "/templates") return json([]);
  if (path === "/providers") {
    return json([
      {
        id: "openai",
        name: "OpenAI",
        available: true,
        models: [{ id: "gpt-5.4-mini", label: "GPT-5.4 Mini", available: true }],
      },
    ]);
  }
  if (path === "/settings/app") {
    return json({
      default_model: "gpt-5.4-mini",
      default_mode: "auto",
      theme: "system",
      workspace_system_prompt: "",
    });
  }
  if (path === "/stats/usage") return json({ totals: {}, by_model: [] });
  if (path === "/diagnostics") {
    return json({
      backend_version: "dev-mock",
      python_version: "3.12.0",
      platform: "browser",
      host: "dev",
      app_support_dir: "/tmp/clawagents-demo",
      projects_file: "/tmp/clawagents-demo/projects.json",
      app_home: "/tmp/clawagents-demo",
      counts: { projects: 1, projectless_chats: 1, project_chats: 1, custom_commands: 0, chat_templates: 0 },
      providers_with_env_keys: ["openai"],
      external_tools: {
        pandoc: false,
        git: true,
        python3: true,
        node: true,
        ffmpeg: false,
        pdftotext: false,
        pdftoppm: false,
        tesseract: false,
      },
    });
  }
  if (path === "/search/chats") return json([]);
  if (path === "/trash/chats") return json([]);
  if (path.match(/^\/projects\/demo-project\/files/)) return json([]);
  if (path === "/projects/demo-project/tree") return json({ name: "demo-project", path: "", type: "dir", children: [] });
  if (path === "/projects/demo-project/git/status") return json({ is_repo: true, branch: "main", status: "", diff: "" });

  return json({ error: `Unhandled mock gateway path: ${method} ${path}` }, 404);
}

export function installDevMockGateway(): GatewayInfo {
  const baseUrl = `${window.location.origin}${MOCK_PREFIX}`;
  if (installed) return { url: baseUrl, token: TOKEN };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.startsWith(MOCK_PREFIX)) return originalFetch(input, init);

    const path = url.pathname.slice(MOCK_PREFIX.length) || "/";
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    return route(path, method, body);
  };

  installed = true;
  return { url: baseUrl, token: TOKEN };
}

export function devMockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  switch (command) {
    case "get_gateway_info":
    case "restart_gateway":
      return Promise.resolve(installDevMockGateway() as T);
    case "keyring_get":
    case "pick_folder":
      return Promise.resolve(null as T);
    case "keyring_get_api_keys":
      return Promise.resolve({ openai: null, anthropic: null, gemini: null } as T);
    case "keyring_set":
    case "keyring_delete":
    case "open_in_finder":
    case "test_ssh_connection":
    case "disconnect_remote_project":
      return Promise.resolve(undefined as T);
    case "list_ssh_hosts":
      return Promise.resolve(["demo-host", "jumpbox"] as T);
    case "open_ssh_config":
      return Promise.resolve("/Users/you/.ssh/config" as T);
    case "connect_remote_project":
      return Promise.resolve({
        project_id: String(args?.projectId ?? "demo"),
        url: `${window.location.origin}${MOCK_PREFIX}`,
        token: TOKEN,
        host: String(args?.host ?? "demo-host"),
        remote_path: String(args?.remotePath ?? "/tmp"),
        local_port: 9,
      } as T);
    case "get_remote_gateway_info":
      return Promise.resolve(null as T);
    case "gateway_log_path":
      return Promise.resolve("/tmp/clawagents-demo/gateway.log" as T);
    default:
      return Promise.reject(new Error(`Unsupported dev mock Tauri command: ${command}`));
  }
}
