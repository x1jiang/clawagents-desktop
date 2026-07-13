import { create } from "zustand";

export type ToastVariant = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

interface ToastsState {
  toasts: Toast[];
  push: (message: string, variant?: ToastVariant, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastsState>((set) => ({
  toasts: [],
  push: (message, variant = "info", action) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant, action }] }));
    // Action toasts stick around longer (the user needs time to read + click);
    // errors next-longest; everything else fades quickly.
    const ttl = action ? 8000 : variant === "error" ? 6000 : 3000;
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for non-React code (e.g. lib utilities). */
export function pushToast(message: string, variant: ToastVariant = "info", action?: ToastAction): void {
  useToasts.getState().push(message, variant, action);
}
