"use client";

import * as React from "react";
import { create } from "zustand";
import { CircleCheck, CircleAlert, Info, X } from "honestui/icons";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string; timeout: number };

type ToastStore = {
  items: ToastItem[];
  push: (toast: Omit<ToastItem, "id" | "timeout"> & { timeout?: number }) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (toast) =>
    set((state) => ({
      items: [...state.items.slice(-3), { id: nextId++, timeout: toast.kind === "error" ? 8000 : 3500, ...toast }],
    })),
  dismiss: (id) => set((state) => ({ items: state.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) => useToasts.getState().push({ kind: "success", title, description }),
  error: (title: string, description?: string) => useToasts.getState().push({ kind: "error", title, description }),
  info: (title: string, description?: string) => useToasts.getState().push({ kind: "info", title, description }),
};

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info };

export function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-[100] flex w-80 flex-col gap-2" role="status" aria-live="polite">
      {items.map((item) => (
        <ToastView key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </div>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  React.useEffect(() => {
    const timer = setTimeout(onDismiss, item.timeout);
    return () => clearTimeout(timer);
  }, [item.timeout, onDismiss]);
  const Icon = ICONS[item.kind];
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-lg border border-fk-border bg-fk-panel p-3 shadow-[0_8px_24px_rgba(0,0,0,0.06)]",
        "animate-in fade-in slide-in-from-bottom-2 duration-200 ease-fk",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          item.kind === "success" && "text-fk-success",
          item.kind === "error" && "text-fk-error",
          item.kind === "info" && "text-fk-text-muted",
        )}
        strokeWidth={1.5}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-5 text-fk-text">{item.title}</p>
        {item.description && <p className="mt-0.5 break-words text-xs leading-4 text-fk-text-secondary">{item.description}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-m-1 rounded p-1 text-fk-text-faint transition-colors hover:text-fk-text"
      >
        <X className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
