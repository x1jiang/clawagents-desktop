import type { Chat } from "../stores/chats";

export interface Project {
  id: string;
  name: string;
  root_path: string;
  default_model: string | null;
  default_mode: string | null;
  created_at: string;
  last_used_at: string;
}

export interface CreateProjectBody {
  name: string;
  root_path: string;
  default_model?: string;
  default_mode?: string;
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

  getChat(chatId: string): Promise<{ id: string; title: string; model: string; mode: string; project_id: string | null; created_at: string; last_message_at: string; status: string }> {
    return this.request(`/chats/${chatId}`);
  }

  getChatMessages(chatId: string): Promise<Array<{ role: string; content: string; tool_call_id?: string | null; tool_calls?: unknown; thinking?: string | null }>> {
    return this.request(`/chats/${chatId}/messages`);
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

  listProviders(): Promise<Array<{ id: string; name: string; available: boolean; models: Array<{ id: string; label: string; available: boolean }> }>> {
    return this.request("/providers");
  }

  patchChat(chatId: string, body: { title?: string; model?: string; mode?: string }): Promise<{ id: string; title: string; model: string; mode: string }> {
    return this.request(`/chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  setApiKey(provider: "openai" | "anthropic" | "gemini", apiKey: string): Promise<{ ok: boolean; env: string; set: boolean }> {
    return this.request("/settings/api-keys", {
      method: "POST",
      body: JSON.stringify({ provider, api_key: apiKey }),
    });
  }
}
