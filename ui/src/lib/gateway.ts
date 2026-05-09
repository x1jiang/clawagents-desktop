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
}
