import type { GatewayDiagnostics, ProviderCatalogEntry } from "./gateway";

export type SetupReadinessStatus = "ready" | "needs-action" | "warning";

export interface SetupReadinessItem {
  id: "provider" | "project" | "documents";
  label: string;
  status: SetupReadinessStatus;
  detail: string;
}

const DOCUMENT_TOOLS = ["pdftotext", "pdftoppm", "tesseract"] as const;

function plural(count: number, singular: string, pluralName = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralName}`;
}

function hasSavedKey(apiKeys: Record<string, string | null | undefined>): boolean {
  return Object.values(apiKeys).some((key) => typeof key === "string" && key.trim().length > 0);
}

function availableModelCount(providers: ProviderCatalogEntry[]): number {
  return providers.reduce(
    (total, provider) => total + provider.models.filter((model) => model.available).length,
    0,
  );
}

function missingToolsDetail(tools: readonly string[]): string {
  const installText = tools.length === 1 ? `${tools[0]} is installed` : `you install ${tools.join(", ")}`;
  return `Text uploads work. OCR/PDF extraction limited until ${installText}.`;
}

export function buildSetupReadiness(
  diagnostics: GatewayDiagnostics,
  providers: ProviderCatalogEntry[],
  apiKeys: Record<string, string | null | undefined>,
): SetupReadinessItem[] {
  const hasProviderKey = diagnostics.providers_with_env_keys.length > 0 || hasSavedKey(apiKeys);
  const models = availableModelCount(providers);
  const missingDocumentTools = DOCUMENT_TOOLS.filter((tool) => !diagnostics.external_tools[tool]);

  return [
    {
      id: "provider",
      label: "Model access",
      status: hasProviderKey ? "ready" : "needs-action",
      detail: hasProviderKey
        ? `${plural(models, "available model")} from ${plural(providers.length, "provider")}.`
        : "No API key detected in keychain or environment.",
    },
    {
      id: "project",
      label: "Workspace",
      status: diagnostics.counts.projects > 0 ? "ready" : "needs-action",
      detail: diagnostics.counts.projects > 0
        ? `${plural(diagnostics.counts.projects, "project")} saved.`
        : "No project folders saved yet.",
    },
    {
      id: "documents",
      label: "Uploads",
      status: missingDocumentTools.length === 0 ? "ready" : "warning",
      detail: missingDocumentTools.length === 0
        ? "PDF and image text extraction tools are available."
        : missingToolsDetail(missingDocumentTools),
    },
  ];
}
