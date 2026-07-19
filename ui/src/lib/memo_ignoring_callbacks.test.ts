import { describe, expect, it } from "vitest";
import { equalIgnoringFunctionProps } from "./memo_ignoring_callbacks";

describe("equalIgnoringFunctionProps", () => {
  it("treats identical data props as equal even with fresh callback identities", () => {
    const shared = { id: 1, args: { a: 1 } };
    const a = { ...shared, onClick: () => {} };
    const b = { ...shared, onClick: () => {} };
    expect(a.onClick).not.toBe(b.onClick);
    expect(equalIgnoringFunctionProps(a, b)).toBe(true);
  });

  it("detects a changed data prop even when callbacks are the same reference", () => {
    const onClick = () => {};
    const a = { content: "old", onClick };
    const b = { content: "new", onClick };
    expect(equalIgnoringFunctionProps(a, b)).toBe(false);
  });

  it("treats a callback flipping from defined to undefined as unchanged (still function-typed on one side is not required)", () => {
    const a: { content: string; onRetry: (() => void) | undefined } = {
      content: "x",
      onRetry: () => {},
    };
    const b: { content: string; onRetry: (() => void) | undefined } = {
      content: "x",
      onRetry: undefined,
    };
    // onRetry: one side is a function, the other undefined -- this DOES
    // matter (it changes whether the row shows a Retry affordance at all),
    // so it must be treated as a real change, not ignored like two
    // function values would be.
    expect(equalIgnoringFunctionProps(a, b)).toBe(false);
  });

  it("ignores differing object/array reference identity only for actual function values, not data", () => {
    const a = { args: { x: 1 } };
    const b = { args: { x: 1 } }; // different object identity, same shape
    // Object.is on two distinct object literals is false even with equal
    // shape -- this is intentional: data props rely on the store keeping
    // stable references for unchanged rows (verified in stores/chats.ts),
    // not deep equality here.
    expect(equalIgnoringFunctionProps(a, b)).toBe(false);
  });
});
