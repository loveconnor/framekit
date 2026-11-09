"use client";

import * as React from "react";
import { LoaderCircle, CircleAlert, ExternalLink, GitBranch } from "honestui/icons";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { api, ApiError } from "@/lib/client/api";
import type { PublishResult, PublishStatus } from "@/lib/project/publish";

type Loaded = { status: PublishStatus; defaultMessage: string; unsavedEdits: boolean };

/**
 * Commit the files Framekit saved and push them; the host (e.g. Vercel) deploys from the push.
 * Mount it with a fresh `key` per opening so its state starts clean.
 */
export function PublishDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<PublishResult | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .publishStatus()
      .then((r) => {
        if (cancelled) return;
        setLoaded(r);
        setMessage(r.defaultMessage);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof ApiError ? e.message : "Couldn't read the repository."));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const status = loaded?.status;
  const ready = status?.available === true;
  const nothing = ready && status.files.length === 0 && status.ahead === 0;
  const blocked = !ready || nothing || status.behind > 0;
  const remoteBranch = ready ? status.upstream.split("/").slice(1).join("/") : "";

  const run = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const r = await api.publish(message);
      setResult(r);
      toast.success(`Pushed to ${r.upstream}`, r.sha ? `Commit ${r.sha.slice(0, 7)}` : undefined);
    } catch (e) {
      setPublishError(e instanceof ApiError ? e.message : "Publishing failed.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !publishing && onOpenChange(o)}>
      <DialogPopup className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{result ? "Published" : "Publish"}</DialogTitle>
          <DialogDescription>
            {result
              ? "Your host deploys from this push. The live site updates when that build finishes, usually in a minute or two."
              : "Commit the changes you saved in Framekit and push them. Your host deploys the site from the push."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4 text-[12.5px]">
          {!loaded && !loadError && (
            <p className="flex items-center gap-2 text-fk-text-muted">
              <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.5} /> Checking the repository…
            </p>
          )}
          {loadError && <Notice>{loadError}</Notice>}
          {status && !status.available && <Notice>{status.reason}</Notice>}

          {result && (
            <div className="flex flex-col gap-1.5">
              <Row label="Pushed to">
                <span className="font-mono text-[11.5px]">{result.upstream}</span>
              </Row>
              {result.sha && (
                <Row label="Commit">
                  {result.commitUrl ? (
                    <a href={result.commitUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11.5px] text-fk-accent hover:underline">
                      {result.sha.slice(0, 7)} <ExternalLink className="size-3" strokeWidth={1.5} />
                    </a>
                  ) : (
                    <span className="font-mono text-[11.5px]">{result.sha.slice(0, 7)}</span>
                  )}
                </Row>
              )}
              {result.pushedCommits > 1 && <p className="text-fk-text-muted">{result.pushedCommits} commits were pushed, including earlier local ones.</p>}
            </div>
          )}

          {ready && !result && (
            <>
              <div className="flex flex-col gap-1.5">
                <Row label="Branch">
                  <span className="inline-flex items-center gap-1 font-mono text-[11.5px]">
                    <GitBranch className="size-3.5 text-fk-text-faint" strokeWidth={1.5} />
                    {status.branch} → {status.upstream}
                  </span>
                </Row>
                {status.repoUrl && (
                  <Row label="Repository">
                    <a href={status.repoUrl} target="_blank" rel="noreferrer" className="truncate font-mono text-[11.5px] text-fk-accent hover:underline">
                      {status.repoUrl.replace(/^https:\/\//, "")}
                    </a>
                  </Row>
                )}
              </div>

              {status.files.length > 0 && (
                <div>
                  <p className="text-[11.5px] font-medium text-fk-text-muted">
                    {status.files.length === 1 ? "1 file" : `${status.files.length} files`} saved in Framekit
                  </p>
                  <ul className="fk-scroll mt-1.5 max-h-36 overflow-y-auto rounded-md border border-fk-border bg-fk-raised px-2.5 py-1.5 font-mono text-[11px] leading-5 text-fk-text">
                    {status.files.map((f) => (
                      <li key={f} className="truncate">{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {status.files.length > 0 && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-medium text-fk-text-muted">Commit message</span>
                  <Textarea size="sm" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} className="resize-none text-[12.5px]" />
                </label>
              )}

              {status.behind > 0 && (
                <Notice>
                  {status.upstream} has {status.behind} new commit{status.behind === 1 ? "" : "s"}. Pull first (<code className="font-mono">git pull</code>), reload the project, then publish.
                </Notice>
              )}
              {nothing && <p className="text-fk-text-muted">Nothing to publish. Save your edits first.</p>}

              <ul className="flex flex-col gap-1 text-[11.5px] leading-4 text-fk-text-muted empty:hidden">
                {loaded?.unsavedEdits && <li>Unsaved edits aren&apos;t included. Save them first to publish them.</li>}
                {status.otherChanges > 0 && (
                  <li>
                    {status.otherChanges} other uncommitted change{status.otherChanges === 1 ? "" : "s"} in this folder {status.otherChanges === 1 ? "is" : "are"} left out.
                  </li>
                )}
                {status.ahead > 0 && (
                  <li>
                    {status.ahead} local commit{status.ahead === 1 ? "" : "s"} not on {status.upstream} yet will be pushed too.
                  </li>
                )}
                {!status.fetched && <li>Couldn&apos;t reach the remote to check for new commits.</li>}
              </ul>
            </>
          )}

          {publishError && <Notice>{publishError}</Notice>}
        </DialogBody>

        <DialogFooter>
          {result ? (
            <DialogClose render={<Button />}>Done</DialogClose>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" disabled={publishing} />}>Cancel</DialogClose>
              <Button disabled={blocked || publishing} onClick={() => void run()}>
                {publishing && <LoaderCircle className="size-4 animate-spin" strokeWidth={1.5} />}
                {publishing ? "Publishing" : remoteBranch ? `Publish to ${remoteBranch}` : "Publish"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="w-20 shrink-0 text-[11.5px] text-fk-text-muted">{label}</span>
      <span className="min-w-0 truncate text-fk-text">{children}</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex gap-2 rounded-md border border-fk-border bg-fk-raised p-2.5 text-[12px] leading-5 text-fk-text">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-fk-error" strokeWidth={1.5} />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
