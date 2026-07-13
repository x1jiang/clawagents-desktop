import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { linkifyPaths } from "./linkify_paths";

// We render the returned segments inside a <pre> so onClick handlers etc. live
// in a real React tree. The tests just inspect the produced DOM.
function renderSegments(text: string, projectId: string | null) {
  return render(<pre>{linkifyPaths(text, projectId)}</pre>).container;
}

describe("linkifyPaths", () => {
  test("no projectId leaves text untouched (no buttons)", () => {
    const c = renderSegments("see src/foo.ts and run", null);
    expect(c.querySelectorAll("button")).toHaveLength(0);
    expect(c.textContent).toBe("see src/foo.ts and run");
  });

  test("renders a path token as a button", () => {
    const c = renderSegments("see src/foo.ts and run", "p1");
    const btns = c.querySelectorAll("button");
    expect(btns).toHaveLength(1);
    expect(btns[0].textContent).toBe("src/foo.ts");
    // Surrounding text preserved.
    expect(c.textContent).toBe("see src/foo.ts and run");
  });

  test("captures multiple paths", () => {
    const c = renderSegments("ls src/foo.ts backend/bar.py done", "p1");
    const btns = c.querySelectorAll("button");
    expect(btns).toHaveLength(2);
    expect(btns[0].textContent).toBe("src/foo.ts");
    expect(btns[1].textContent).toBe("backend/bar.py");
  });

  test("preserves a trailing :line suffix in the visible token", () => {
    const c = renderSegments("error at src/foo.ts:42", "p1");
    const btns = c.querySelectorAll("button");
    expect(btns).toHaveLength(1);
    expect(btns[0].textContent).toBe("src/foo.ts:42");
  });

  test("does not link bare filenames or URLs", () => {
    const c = renderSegments("install foo.ts from https://example.com/x.ts", "p1");
    expect(c.querySelectorAll("button")).toHaveLength(0);
  });

  test("empty input returns empty", () => {
    const c = renderSegments("", "p1");
    expect(c.textContent).toBe("");
    expect(c.querySelectorAll("button")).toHaveLength(0);
  });

  test("text with no paths is left as-is (no buttons)", () => {
    const c = renderSegments("hello world, nothing to see here.", "p1");
    expect(c.querySelectorAll("button")).toHaveLength(0);
    expect(c.textContent).toBe("hello world, nothing to see here.");
  });
});
