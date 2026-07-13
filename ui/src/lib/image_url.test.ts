import { describe, expect, test } from "vitest";
import { rewriteImageSrc } from "./image_url";

const ctx = { baseUrl: "http://127.0.0.1:9000", bearerToken: "tok", projectId: "p1" };

describe("rewriteImageSrc", () => {
  test("passes absolute https URLs through", () => {
    expect(rewriteImageSrc("https://example.com/x.png", ctx)).toBe("https://example.com/x.png");
  });

  test("passes data: URIs through", () => {
    const data = "data:image/png;base64,iVBORw0K";
    expect(rewriteImageSrc(data, ctx)).toBe(data);
  });

  test("passes tauri:/asset:/file: URLs through", () => {
    expect(rewriteImageSrc("tauri://localhost/x.png", ctx)).toBe("tauri://localhost/x.png");
    expect(rewriteImageSrc("asset://localhost/x.png", ctx)).toBe("asset://localhost/x.png");
    expect(rewriteImageSrc("file:///Users/me/x.png", ctx)).toBe("file:///Users/me/x.png");
  });

  test("rewrites relative paths to the gateway serve endpoint", () => {
    const url = rewriteImageSrc("docs/diagram.png", ctx);
    expect(url).toBe(
      "http://127.0.0.1:9000/projects/p1/files/serve?path=docs%2Fdiagram.png&token=tok",
    );
  });

  test("strips a leading ./", () => {
    const url = rewriteImageSrc("./pic.png", ctx);
    expect(url).toContain("path=pic.png");
  });

  test("strips a leading /", () => {
    const url = rewriteImageSrc("/pic.png", ctx);
    expect(url).toContain("path=pic.png");
  });

  test("returns raw when no context", () => {
    expect(rewriteImageSrc("docs/x.png", null)).toBe("docs/x.png");
  });

  test("returns empty for empty input", () => {
    expect(rewriteImageSrc("", ctx)).toBe("");
  });

  test("url-encodes both path and token", () => {
    const url = rewriteImageSrc("a b/c.png", { ...ctx, bearerToken: "tok with spaces" });
    expect(url).toContain("path=a%20b%2Fc.png");
    expect(url).toContain("token=tok%20with%20spaces");
  });
});
