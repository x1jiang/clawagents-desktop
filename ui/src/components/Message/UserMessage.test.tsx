import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UserMessage } from "./UserMessage";
import type { ChatAttachment } from "../../lib/gateway";

const attachment: ChatAttachment = {
  id: "a1",
  filename: "report.pdf",
  mime_type: "application/pdf",
  size: 2048,
  path: "/tmp/report.pdf",
  kind: "pdf",
  text_preview: "report text",
  text_truncated: false,
  checksum: "sha256:abc",
  chunks_count: 2,
  warnings: ["vision reference: ![report.pdf](/tmp/report.pdf)"],
  created_at: 1,
};

describe("UserMessage attachments", () => {
  test("renders attachment actions", () => {
    const onReveal = vi.fn();
    const onDownload = vi.fn();
    const onDelete = vi.fn();

    render(
      <UserMessage
        content="Analyze this"
        attachments={[attachment]}
        onRevealAttachment={onReveal}
        onDownloadAttachment={onDownload}
        onDeleteAttachment={onDelete}
      />,
    );

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reveal/i }));
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    expect(onReveal).toHaveBeenCalledWith(attachment);
    expect(onDownload).toHaveBeenCalledWith(attachment);
    expect(onDelete).toHaveBeenCalledWith(attachment);
  });

  test("passes attachments when editing and resending", () => {
    const onRetry = vi.fn();

    render(
      <UserMessage
        content="Analyze this"
        attachments={[attachment]}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const editor = screen.getByDisplayValue("Analyze this");
    fireEvent.change(editor, { target: { value: "Analyze this again" } });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: false });

    expect(onRetry).toHaveBeenCalledWith("Analyze this again", [attachment]);
  });
});
