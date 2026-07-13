/**
 * Rewrite a Markdown `<img>` src so relative project paths resolve via the
 * gateway's /files/serve endpoint. Absolute URLs and data:/tauri:/asset:/
 * file: URLs pass through untouched.
 */
export function rewriteImageSrc(
  raw: string,
  ctx: { baseUrl: string; bearerToken: string; projectId: string } | null,
): string {
  if (!raw) return raw;
  if (/^(https?:|data:|tauri:|asset:|file:)/i.test(raw)) return raw;
  if (!ctx) return raw;
  const cleaned = raw.replace(/^\.?\//, "");
  return (
    `${ctx.baseUrl}/projects/${encodeURIComponent(ctx.projectId)}/files/serve` +
    `?path=${encodeURIComponent(cleaned)}` +
    `&token=${encodeURIComponent(ctx.bearerToken)}`
  );
}
