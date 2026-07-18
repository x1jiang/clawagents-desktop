import { describe, expect, test } from "vitest";
import type { GatewayDiagnostics, ProviderCatalogEntry } from "./gateway";
import { buildSetupReadiness } from "./setup_readiness";

const diagnostics: GatewayDiagnostics = {
  backend_version: "6.8.1",
  python_version: "3.12.0",
  platform: "macOS",
  host: "dev",
  app_support_dir: "/tmp/clawagents",
  projects_file: "/tmp/clawagents/projects.json",
  counts: {
    projects: 0,
    projectless_chats: 1,
    project_chats: 0,
    custom_commands: 0,
    chat_templates: 0,
  },
  providers_with_env_keys: [],
  external_tools: {
    git: true,
    python3: true,
    node: true,
    pdftotext: false,
    pdftoppm: false,
    tesseract: false,
  },
};

const providers: ProviderCatalogEntry[] = [
  {
    id: "openai",
    name: "OpenAI",
    available: true,
    models: [{ id: "gpt-5.4-mini", label: "GPT-5.4 Mini", available: true }],
  },
];

describe("setup readiness", () => {
  test("flags missing provider keys and missing document analysis tools", () => {
    const items = buildSetupReadiness(diagnostics, providers, { openai: null });

    expect(items.find((item) => item.id === "provider")?.status).toBe("needs-action");
    expect(items.find((item) => item.id === "project")?.status).toBe("needs-action");
    expect(items.find((item) => item.id === "documents")?.status).toBe("warning");
    expect(items.find((item) => item.id === "documents")?.detail).toContain("OCR");
  });

  test("marks setup ready when key, project, and extraction tools exist", () => {
    const ready = buildSetupReadiness(
      {
        ...diagnostics,
        counts: { ...diagnostics.counts, projects: 2 },
        external_tools: {
          ...diagnostics.external_tools,
          pdftotext: true,
          pdftoppm: true,
          tesseract: true,
        },
      },
      providers,
      { openai: "sk-test" },
    );

    expect(ready.map((item) => item.status)).toEqual(["ready", "ready", "ready", "warning"]);
  });

  test("marks companions ready when floors are met", () => {
    const ready = buildSetupReadiness(
      {
        ...diagnostics,
        counts: { ...diagnostics.counts, projects: 1 },
        companions: [
          { name: "context-mode", found: true, ok: true, detail: "ok" },
          { name: "rtk", found: true, ok: true, detail: "ok" },
        ],
        external_tools: {
          ...diagnostics.external_tools,
          pdftotext: true,
          pdftoppm: true,
          tesseract: true,
          "context-mode": true,
          rtk: true,
        },
      },
      providers,
      { openai: "sk-test" },
    );
    expect(ready.find((item) => item.id === "companions")?.status).toBe("ready");
  });
});
