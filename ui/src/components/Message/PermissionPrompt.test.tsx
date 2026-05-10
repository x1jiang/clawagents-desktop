import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionPrompt } from "./PermissionPrompt";

describe("PermissionPrompt", () => {
  test("renders three buttons before resolved", () => {
    const onResolve = vi.fn();
    render(
      <PermissionPrompt
        request_id="r1"
        tool="write_file"
        file_path="/Users/me/escape.txt"
        reason="outside project root"
        projectId="p1"
        onResolve={onResolve}
      />,
    );
    expect(screen.getByRole("button", { name: /allow once/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /allow always/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  test("clicking allow_once invokes onResolve", () => {
    const onResolve = vi.fn();
    render(
      <PermissionPrompt
        request_id="r1"
        tool="write_file"
        file_path="/x"
        reason="r"
        projectId="p1"
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    expect(onResolve).toHaveBeenCalledWith("allow_once");
  });

  test("hides allow_always for projectless chats", () => {
    render(
      <PermissionPrompt
        request_id="r1"
        tool="write_file"
        file_path="/x"
        reason="r"
        projectId={null}
        onResolve={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /allow always/i })).not.toBeInTheDocument();
  });

  test("when resolved, shows decision and disables buttons", () => {
    render(
      <PermissionPrompt
        request_id="r1"
        tool="write_file"
        file_path="/x"
        reason="r"
        projectId="p1"
        resolved="deny"
        onResolve={() => {}}
      />,
    );
    expect(screen.getByText(/decision: deny/i)).toBeInTheDocument();
  });
});
