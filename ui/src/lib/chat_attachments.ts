export interface OwnedComposerAttachment<TAttachment = unknown> {
  localId: string;
  ownerChatId: string;
  status: "uploading" | "ready" | "error";
  attachment?: TAttachment;
  abort?: AbortController;
}

export function attachmentsForChat<T extends OwnedComposerAttachment>(
  items: T[],
  chatId: string,
): T[] {
  return items.filter((item) => item.ownerChatId === chatId);
}

export function abortAndDropOtherChats<T extends OwnedComposerAttachment>(
  items: T[],
  activeChatId: string,
): { remaining: T[] } {
  for (const item of items) {
    if (item.ownerChatId !== activeChatId) item.abort?.abort();
  }
  return { remaining: attachmentsForChat(items, activeChatId) };
}

export function updateOwnedAttachment<T extends OwnedComposerAttachment>(
  items: T[],
  activeChatId: string,
  ownerChatId: string,
  localId: string,
  update: (item: T) => T,
): T[] {
  if (activeChatId !== ownerChatId) return items;
  return items.map((item) =>
    item.localId === localId && item.ownerChatId === ownerChatId ? update(item) : item,
  );
}
