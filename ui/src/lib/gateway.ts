import type { Chat } from "../stores/chats";

export interface Project {
  id: string;
  name: string;
  root_path: string;
  default_model: string | null;
  default_mode: string | null;
  system_prompt: string | null;
  env_vars: Record<string, string> | null;
  pinned?: boolean;
  created_at: string;
  last_used_at: string;
  kind?: string;
  ssh_host?: string | null;
  remote_path?: string | null;
}

export interface CreateProjectBody {
  name: string;
  root_path: string;
  default_model?: string;
  default_mode?: string;
  system_prompt?: string;
  env_vars?: Record<string, string>;
  kind?: string;
  ssh_host?: string;
  remote_path?: string;
  id?: string;
}

export interface ProjectPatchBody {
  name?: string;
  default_model?: string;
  default_mode?: string;
  system_prompt?: string | null;
  env_vars?: Record<string, string> | null;
  pinned?: boolean;
}

export interface ChatAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  path: string;
  kind: string;
  text_preview: string;
  text_truncated: boolean;
  checksum: string;
  chunks_count: number;
  warnings: string[];
  created_at: number;
  deduped?: boolean;
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  available: boolean;
  base_url?: string | null;
  models: Array<{ id: string; label: string; available: boolean }>;
}

export interface GatewayDiagnostics {
  backend_version: string;
  python_version: string;
  platform: string;
  host: string;
  app_support_dir: string;
  projects_file: string;
  counts: {
    projects: number;
    projectless_chats: number;
    project_chats: number;
    custom_commands: number;
    chat_templates: number;
  };
  providers_with_env_keys: string[];
  external_tools: Record<string, boolean>;
}

export interface AppSettings {
  default_model: string;
  default_mode: string;
  theme: string;
  workspace_system_prompt: string;
  provider: string;
  base_url: string;
  trust_custom_base_url: boolean;
  aws_region: string;
  aws_profile: string;
  mcp_enabled: boolean;
  mcp_trust_workspace: boolean;
  context_mode: boolean;
  browser_tools: boolean;
  trajectory: boolean;
  learn: boolean;
  action_mode: string;
  agent_mode: string;
  allow_full_access: boolean;
  has_aws_credentials?: boolean;
}

export interface AutoApprove {
  edit: boolean;
  execute: boolean;
  web: boolean;
  browser: boolean;
}

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function fileToBase64(
  file: File,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    const abort = () => {
      reader.abort();
      cleanup();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    reader.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.round((event.loaded / event.total) * 85));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error ?? new Error("Unable to read file"));
    };
    reader.onload = () => {
      cleanup();
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      options.onProgress?.(90);
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export class GatewayClient {
  constructor(private url: string, private token: string) {}

  get baseUrl(): string {
    return this.url;
  }

  get bearerToken(): string {
    return this.token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.text();
        detail = body || detail;
      } catch {
        // fall through with statusText
      }
      throw new Error(`${response.status}: ${detail}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  listProjects(): Promise<Project[]> {
    return this.request<Project[]>("/projects");
  }

  createProject(body: CreateProjectBody): Promise<Project> {
    return this.request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  patchProject(projectId: string, body: ProjectPatchBody): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  listProjectChats(projectId: string): Promise<Chat[]> {
    return this.request<Chat[]>(`/projects/${projectId}/chats`);
  }

  createProjectChat(projectId: string, body: { title?: string; model?: string; mode?: string }): Promise<{ chat_id: string }> {
    return this.request<{ chat_id: string }>(`/projects/${projectId}/chats`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  listProjectlessChats(): Promise<Chat[]> {
    return this.request<Chat[]>("/chats");
  }

  createProjectlessChat(body: { title?: string; model?: string; mode?: string }): Promise<{ chat_id: string }> {
    return this.request<{ chat_id: string }>("/chats", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getChat(chatId: string): Promise<{ id: string; title: string; model: string; mode: string; project_id: string | null; pinned?: boolean; note?: string; created_at: string; last_message_at: string; status: string }> {
    return this.request(`/chats/${chatId}`);
  }

  getChatMessages(chatId: string): Promise<Array<{ role: string; content: string; tool_call_id?: string | null; tool_calls?: unknown; thinking?: string | null }>> {
    return this.request(`/chats/${chatId}/messages`);
  }

  getChatEvents(chatId: string, limit = 500): Promise<Array<{ type: string; ts?: number; [k: string]: unknown }>> {
    return this.request(`/chats/${chatId}/events?limit=${limit}`);
  }

  cancelChat(chatId: string): Promise<{ ok: boolean }> {
    return this.request(`/chats/${chatId}/cancel`, { method: "POST" });
  }

  resolvePermission(requestId: string, decision: "allow_once" | "allow_always" | "deny"): Promise<{ ok: boolean }> {
    return this.request(`/permissions/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
  }

  listProviders(): Promise<ProviderCatalogEntry[]> {
    return this.request("/providers");
  }

  patchChat(chatId: string, body: { title?: string; model?: string; mode?: string; pinned?: boolean; note?: string }): Promise<{ id: string; title: string; model: string; mode: string; pinned?: boolean; note?: string }> {
    return this.request(`/chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async uploadChatAttachment(
    chatId: string,
    file: File,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
  ): Promise<ChatAttachment> {
    const data = await fileToBase64(file, options);
    const uploaded = await this.request<ChatAttachment>(`/chats/${chatId}/attachments`, {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify({
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        data_base64: data,
      }),
    });
    options.onProgress?.(100);
    return uploaded;
  }

  listChatAttachments(chatId: string): Promise<ChatAttachment[]> {
    return this.request<ChatAttachment[]>(`/chats/${chatId}/attachments`);
  }

  deleteChatAttachment(chatId: string, attachmentId: string): Promise<{ ok: boolean }> {
    return this.request(`/chats/${chatId}/attachments/${attachmentId}`, { method: "DELETE" });
  }

  async downloadChatAttachment(chatId: string, attachmentId: string): Promise<Blob> {
    const response = await fetch(`${this.url}/chats/${chatId}/attachments/${attachmentId}/download`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`${response.status}: ${detail}`);
    }
    return response.blob();
  }

  setApiKey(
    provider: "openai" | "anthropic" | "gemini" | "bedrock",
    apiKey: string,
  ): Promise<{ ok: boolean; env: string; set: boolean }> {
    return this.request("/settings/api-keys", {
      method: "POST",
      body: JSON.stringify({ provider, api_key: apiKey }),
    });
  }

  getAppSettings(): Promise<AppSettings> {
    return this.request("/settings/app");
  }

  patchAppSettings(body: Partial<AppSettings>): Promise<AppSettings> {
    return this.request("/settings/app", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  listMcp(projectId?: string | null): Promise<{
    mcp_enabled: boolean;
    mcp_trust_workspace: boolean;
    context_mode: boolean;
    context_mode_available: boolean;
    servers: Array<{ name: string; disabled: boolean; command?: string; url?: string; source: string }>;
  }> {
    const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    return this.request(`/mcp${q}`);
  }

  listCheckpoints(chatId: string, limit = 30): Promise<Array<Record<string, unknown>>> {
    return this.request(`/chats/${chatId}/checkpoints?limit=${limit}`);
  }

  restoreCheckpoint(chatId: string, sha: string, mode: "files" | "conversation" | "both" = "files"): Promise<Record<string, unknown>> {
    return this.request(`/chats/${chatId}/checkpoints/restore`, {
      method: "POST",
      body: JSON.stringify({ sha, mode }),
    });
  }

  listSnapshots(chatId: string, limit = 50): Promise<Array<{ id: string; path: string; mtime: number; files: string[] }>> {
    return this.request(`/chats/${chatId}/snapshots?limit=${limit}`);
  }

  restoreSnapshot(chatId: string, snapshotId: string, rel: string, destRel?: string): Promise<{ ok: boolean; restored: string }> {
    return this.request(`/chats/${chatId}/snapshots/restore`, {
      method: "POST",
      body: JSON.stringify({ snapshot_id: snapshotId, rel, dest_rel: destRel }),
    });
  }

  resolveAskUser(requestId: string, answer: string | null, skip = false): Promise<{ ok: boolean }> {
    return this.request(`/ask_user/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ answer, skip }),
    });
  }

  async exportChatMarkdown(chatId: string): Promise<string> {
    const response = await fetch(`${this.url}/chats/${chatId}/export`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
    return response.text();
  }

  listPermissionGrants(projectId: string): Promise<Array<{ project_id: string; path_pattern: string; scope: string; granted_at: string }>> {
    return this.request(`/projects/${projectId}/permission-grants`);
  }

  revokePermissionGrant(projectId: string, pathPattern: string, scope: string): Promise<{ ok: boolean }> {
    return this.request(`/projects/${projectId}/permission-grants/revoke`, {
      method: "POST",
      body: JSON.stringify({ path_pattern: pathPattern, scope }),
    });
  }

  revokeAllPermissionGrants(projectId: string): Promise<void> {
    return this.request(`/projects/${projectId}/permission-grants`, { method: "DELETE" });
  }

  addPermissionGrant(projectId: string, pathPattern: string, scope: "read" | "write"): Promise<{ project_id: string; path_pattern: string; scope: string; granted_at: string }> {
    return this.request(`/projects/${projectId}/permission-grants`, {
      method: "POST",
      body: JSON.stringify({ path_pattern: pathPattern, scope }),
    });
  }

  listProjectFiles(projectId: string, q: string = ""): Promise<Array<{ path: string }>> {
    const query = q ? `?q=${encodeURIComponent(q)}` : "";
    return this.request(`/projects/${projectId}/files${query}`);
  }

  previewProjectFile(projectId: string, path: string): Promise<{ path: string; size: number; truncated: boolean; binary: boolean; content: string }> {
    return this.request(`/projects/${projectId}/files/preview?path=${encodeURIComponent(path)}`);
  }

  readProjectFile(projectId: string, path: string): Promise<{
    path: string;
    size: number;
    truncated: boolean;
    binary: boolean;
    content: string;
    writable: boolean;
  }> {
    return this.request(`/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`);
  }

  writeProjectFile(projectId: string, path: string, content: string): Promise<{ path: string; size: number; ok: boolean }> {
    return this.request(`/projects/${projectId}/files/content`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    });
  }

  projectTree(projectId: string): Promise<TreeNode> {
    return this.request<TreeNode>(`/projects/${projectId}/tree`);
  }

  listRecentProjectFiles(projectId: string): Promise<Array<{ path: string; mtime: number }>> {
    return this.request(`/projects/${projectId}/files/recent`);
  }

  projectGitStatus(projectId: string): Promise<{ is_repo: boolean; branch?: string; status?: string; status_truncated?: boolean; diff?: string; diff_truncated?: boolean; error?: string }> {
    return this.request(`/projects/${projectId}/git/status`);
  }

  async exportBackup(): Promise<Blob> {
    const response = await fetch(`${this.url}/backup/export`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
    return response.blob();
  }

  async importBackup(file: File | Blob): Promise<{ ok: boolean; projects_added: number; chats_restored: number; commands_restored: number }> {
    const form = new FormData();
    form.append("file", file, file instanceof File ? file.name : "backup.zip");
    const response = await fetch(`${this.url}/backup/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`${response.status}: ${detail}`);
    }
    return response.json();
  }

  searchChats(q: string): Promise<Array<{ chat_id: string; project_id: string | null; title: string; role: string; snippet: string }>> {
    return this.request(`/search/chats?q=${encodeURIComponent(q)}`);
  }

  truncateAfterLastUserMessage(chatId: string): Promise<{ truncated: number }> {
    return this.request(`/chats/${chatId}/truncate-after-last-user-message`, { method: "POST" });
  }

  forkChat(chatId: string): Promise<{ chat_id: string; project_id: string | null; title: string }> {
    return this.request(`/chats/${chatId}/fork`, { method: "POST" });
  }

  usageStats(): Promise<{
    overall: Record<string, ModelUsage>;
    projectless: Record<string, ModelUsage>;
    projects: Array<{ project_id: string; project_name: string; by_model: Record<string, ModelUsage> }>;
  }> {
    return this.request("/stats/usage");
  }

  listCustomCommands(): Promise<Array<{ name: string; description: string; body: string }>> {
    return this.request("/commands");
  }

  diagnostics(): Promise<GatewayDiagnostics> {
    return this.request("/diagnostics");
  }

  revealFolder(path: string): Promise<{ ok: boolean; path: string }> {
    return this.request("/system/reveal-folder", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  }

  revealWellKnown(name: "app-support" | "commands" | "templates"): Promise<{ ok: boolean; path: string }> {
    return this.request("/system/reveal-well-known", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  restoreChat(chatId: string): Promise<{ ok: boolean }> {
    return this.request(`/chats/${chatId}/restore`, { method: "POST" });
  }

  listTrashedChats(): Promise<Array<{ chat_id: string; project_id: string | null; trashed_at: number; filename: string }>> {
    return this.request("/trash/chats");
  }

  emptyTrash(): Promise<void> {
    return this.request("/trash/chats", { method: "DELETE" });
  }

  moveChat(chatId: string, projectId: string | null): Promise<{ ok: boolean; moved: boolean; reason?: string }> {
    return this.request(`/chats/${chatId}/move`, {
      method: "POST",
      body: JSON.stringify({ project_id: projectId }),
    });
  }

  upsertCustomCommand(name: string, body: { description?: string; body: string }): Promise<{ name: string; description: string; body: string }> {
    return this.request(`/commands/${name}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  deleteCustomCommand(name: string): Promise<void> {
    return this.request(`/commands/${name}`, { method: "DELETE" });
  }

  listChatTemplates(): Promise<Array<{ name: string; description: string; body: string }>> {
    return this.request("/templates");
  }

  upsertChatTemplate(name: string, body: { description?: string; body: string }): Promise<{ name: string; description: string; body: string }> {
    return this.request(`/templates/${name}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  deleteChatTemplate(name: string): Promise<void> {
    return this.request(`/templates/${name}`, { method: "DELETE" });
  }

  /**
   * Skills the agent will auto-load for this project — driven by `SKILL.md`
   * files under one of the recognised skill directories
   * (`skills/`, `.skills/`, `.agents/skills/`, `.cursor/skills/`, …).
   */
  discoveredSkills(projectId: string): Promise<{
    root: string;
    skills: Array<{ name: string; description: string; source_dir: string; path: string }>;
  }> {
    return this.request(`/skills/discovered?project_id=${encodeURIComponent(projectId)}`);
  }

  /**
   * Hit the provider's models endpoint to confirm a key actually authenticates.
   * Returns shape: { ok, status, message, model_count }. Used by Settings "Test".
   */
  verifyApiKey(
    provider: "openai" | "anthropic" | "gemini" | "bedrock",
    apiKey: string = "",
  ): Promise<{
    ok: boolean;
    status: number;
    message: string;
    model_count: number | null;
  }> {
    return this.request(`/settings/verify-key`, {
      method: "POST",
      body: JSON.stringify({ provider, api_key: apiKey }),
    });
  }

  autoTitleChat(chatId: string): Promise<{ title: string; changed: boolean; error?: string }> {
    return this.request(`/chats/${chatId}/auto-title`, { method: "POST" });
  }

  compactChat(chatId: string): Promise<{ compacted: boolean; summary_chars?: number; backup_path?: string; reason?: string }> {
    return this.request(`/chats/${chatId}/compact`, { method: "POST" });
  }

  listCompactBackups(chatId: string): Promise<Array<{ filename: string; ts: number; size: number; suffix: string }>> {
    return this.request(`/chats/${chatId}/compact/backups`);
  }

  restoreCompactBackup(chatId: string, suffix: string): Promise<{ ok: boolean; safety_backup: string }> {
    return this.request(`/chats/${chatId}/compact/restore`, {
      method: "POST",
      body: JSON.stringify({ suffix }),
    });
  }
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  cache_creation_tokens: number;
  turns: number;
}

export interface TreeNode {
  name: string;
  type: "file" | "dir";
  children?: TreeNode[];
}
