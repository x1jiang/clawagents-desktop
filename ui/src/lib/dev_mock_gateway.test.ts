import { describe, expect, test } from "vitest";
import { installDevMockGateway } from "./dev_mock_gateway";
import { tauriApi } from "./tauri";

describe("dev mock gateway", () => {
  test("installs a same-origin mock gateway for browser QA", async () => {
    const info = installDevMockGateway();

    expect(info.url).toContain("/__clawagents_mock_gateway");
    const health = await fetch(`${info.url}/health`);
    const projects = await fetch(`${info.url}/projects`).then((response) => response.json());

    expect(health.ok).toBe(true);
    expect(projects[0]).toMatchObject({
      id: "demo-project",
      name: "Demo Project",
    });
  });

  test("tauri API falls back to the dev mock outside desktop runtime", async () => {
    const info = await tauriApi.getGatewayInfo();

    expect(info.token).toBe("dev-mock-token");
    await expect(tauriApi.keyringGet("service", "openai")).resolves.toBeNull();
  });

  test("accepts chat attachment uploads for browser QA", async () => {
    const info = installDevMockGateway();
    const response = await fetch(`${info.url}/chats/demo-chat/attachments`, {
      method: "POST",
      body: JSON.stringify({
        filename: "notes.txt",
        mime_type: "text/plain",
        data_base64: btoa("Upload notes for analysis"),
      }),
    });

    expect(response.ok).toBe(true);
    const uploaded = await response.json();
    expect(uploaded).toMatchObject({
      filename: "notes.txt",
      mime_type: "text/plain",
      kind: "text",
      text_preview: "Upload notes for analysis",
      text_truncated: false,
    });
    expect(uploaded.path).toContain("/mock-uploads/demo-chat/");
  });
});
