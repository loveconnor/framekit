"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, ChevronRight } from "honestui/icons";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/store/editor-store";
import { api } from "@/lib/client/api";
import { stripAnsi } from "./status-bar";
import { cn } from "@/lib/utils";

const STEPS: Array<{ phase: string; label: string }> = [
  { phase: "checking", label: "Checking project" },
  { phase: "preparing", label: "Preparing preview" },
  { phase: "starting", label: "Starting development server" },
  { phase: "loading", label: "Loading website" },
];

export function ImportProgress() {
  const router = useRouter();
  const phase = useEditor((s) => s.phase);
  const error = useEditor((s) => s.error);
  const devLog = useEditor((s) => s.devLog);
  const project = useEditor((s) => s.project);
  const [showDetail, setShowDetail] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const currentIndex = STEPS.findIndex((s) => s.phase === phase);

  if (phase === "error") {
    const detail = error?.detail || stripAnsi(devLog).trim();
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-[460px] rounded-lg border border-fk-border bg-fk-panel p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <p className="text-[11px] font-medium text-fk-error">Couldn&apos;t open the project</p>
          <p className="mt-1 text-[14px] font-medium leading-5 text-fk-text">{error?.message ?? "Something stopped the import."}</p>
          {error?.suggestion && <pre className="mt-3 rounded-md bg-fk-raised px-3 py-2 font-mono text-xs text-fk-text">{error.suggestion}</pre>}
          {detail && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowDetail((v) => !v)} className="inline-flex items-center gap-1 text-xs text-fk-text-muted hover:text-fk-text">
                <ChevronRight className={cn("size-3.5 transition-transform duration-150", showDetail && "rotate-90")} strokeWidth={1.5} />
                Technical details
              </button>
              {showDetail && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-fk-raised p-3 font-mono text-[11px] leading-4 text-fk-text-secondary">{detail}</pre>}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              disabled={retrying || !project}
              onClick={async () => {
                if (!project) return;
                setRetrying(true);
                try {
                  await api.openProject(project.root);
                  const { snapshot } = await api.current();
                  useEditor.getState().applySnapshot(snapshot);
                } finally {
                  setRetrying(false);
                }
              }}
            >
              {retrying && <LoaderCircle className="size-4 animate-spin" strokeWidth={1.5} />}
              Retry
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push("/")}>
              Back to projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <ol className="flex w-56 flex-col gap-2" aria-label="Import progress">
        {STEPS.map((step, index) => {
          const done = index < currentIndex || phase === "ready";
          const active = index === currentIndex;
          return (
            <li key={step.phase} className={cn("flex items-center gap-2 text-[12px] leading-4", done ? "text-fk-text-muted" : active ? "text-fk-text" : "text-fk-text-faint")}>
              <span className="flex size-4 items-center justify-center">
                {done ? <Check className="size-3.5 text-fk-success" strokeWidth={1.5} /> : active ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} /> : <span className="size-1 rounded-full bg-current" />}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
