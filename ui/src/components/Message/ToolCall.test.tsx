import { describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolCall } from "./ToolCall";

describe("ToolCall", () => {
  test("collapsed by default for read-only tools", () => {
    render(
      <ToolCall name="read_file" args={{ path: "/tmp/x" }} running={false} success={true} result="hello" />,
    );
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
  });

  test("expanded by default for write tools", () => {
    render(
      <ToolCall name="write_file" args={{ path: "/tmp/x" }} running={false} success={true} result="ok" />,
    );
    expect(screen.queryByText("ok")).toBeInTheDocument();
  });

  test("toggles on click", () => {
    render(
      <ToolCall name="read_file" args={{ path: "/tmp/x" }} running={false} success={true} result="hello" />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("hello")).toBeInTheDocument();
  });

  test("shows running spinner when not yet completed", () => {
    render(<ToolCall name="execute" args={{ command: "ls" }} running={true} />);
    expect(screen.getByLabelText("running")).toBeInTheDocument();
  });
});
