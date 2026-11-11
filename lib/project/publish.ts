import { execFile } from "node:child_process";
import path from "node:path";
import { clearPendingPublish, getPendingPublish } from "@/lib/filesystem/config-store";
import { SessionError } from "@/lib/session/session";

/**
 * Publish = commit the files Framekit saved, then push them to the branch's upstream.
 * The host (e.g. Vercel) deploys from the push; Framekit never deploys anything itself.
 * Only Framekit-saved files are committed; the user's other uncommitted work is left alone.
 */

export type PublishStatus =
  | { available: false; reason: string }
  | {
      available: true;
      branch: string;
      /** e.g. `origin/main`. */
      upstream: string;
      /** Browser URL of the remote repository when it's on GitHub/GitLab/Bitbucket. */
      repoUrl: string | null;
      /** Framekit-saved files with changes not yet committed, project-relative. */
      files: string[];
      /** Uncommitted changes in the project folder that Framekit did not make (left out of the commit). */
      otherChanges: number;
      /** Local commits not on the upstream yet; they go out with the next push. */
      ahead: number;
      /** Upstream commits missing locally; publishing is blocked until they're pulled. */
      behind: number;
      /** False when the remote couldn't be reached, so `behind` may be stale. */
      fetched: boolean;
    };

export type PublishResult = {
  sha: string | null;
  branch: string;
  upstream: string;
  commitUrl: string | null;
  files: string[];
  pushedCommits: number;
  /** Newer upstream commits changed the project's files and were brought in; the project must be reopened. */
  synced: boolean;
};

export type PublishOptions = {
  /** Hosted mode: email of the signed-in person publishing. Recorded in the commit. */
  publisher?: string | null;
  /** Hosted mode: bring in newer upstream commits instead of asking for a `git pull` nobody there can run. */
  sync?: boolean;
};

type Git = (args: string[], opts?: { timeout?: number; env?: Record<string, string> }) => Promise<string>;

function gitIn(cwd: string): Git {
  return (args, opts) =>
    new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        {
          cwd,
          timeout: opts?.timeout ?? 30_000,
          maxBuffer: 8 * 1024 * 1024,
          // Never block on a credential prompt in a background process.
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...opts?.env },
        },
        (error, stdout, stderr) => {
          if (error) reject(new Error((stderr || error.message).trim()));
          else resolve(stdout);
        },
      );
    });
}

async function inspect(projectRoot: string, { fetch }: { fetch: boolean }) {
  const git = gitIn(projectRoot);
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { available: false as const, reason: "This project isn't in a git repository, so there's nowhere to publish to." };
  }
  const branch = (await git(["branch", "--show-current"])).trim();
  if (!branch) return { available: false as const, reason: "The repository is in a detached HEAD state. Check out a branch to publish." };
  let upstream: string;
  try {
    upstream = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
  } catch {
    return { available: false as const, reason: `Branch ${branch} has no upstream. Push it once from a terminal (git push -u origin ${branch}).` };
  }
  const remote = (await git(["config", "--get", `branch.${branch}.remote`]).catch(() => "")).trim() || upstream.split("/")[0];
  const remoteBranch = (await git(["config", "--get", `branch.${branch}.merge`]).catch(() => "")).trim().replace(/^refs\/heads\//, "") || branch;

  let fetched = false;
  if (fetch) {
    fetched = await git(["fetch", "--quiet", remote, remoteBranch], { timeout: 20_000 }).then(() => true, () => false);
  }
  const [aheadRaw, behindRaw] = (await git(["rev-list", "--left-right", "--count", "HEAD...@{u}"])).trim().split(/\s+/);

  // Paths in porcelain output are repo-relative; Framekit tracks project-relative ones.
  const prefix = (await git(["rev-parse", "--show-prefix"])).trim();
  const changed = new Set<string>();
  const porcelain = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  const entries = porcelain.split("\0").filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (status.includes("R") || status.includes("C")) i++; // the original path follows a rename/copy
    // Relative to the project folder, so files outside it read `../shared/x.ts`, as Framekit tracks them.
    changed.add(path.posix.relative(prefix.replace(/\/$/, "") || ".", file) || file);
  }
  const pending = await getPendingPublish(projectRoot);
  const files = pending.filter((f) => changed.has(f));
  // Files Framekit saved that are no longer changed were committed some other way: forget them.
  const stale = pending.filter((f) => !changed.has(f));
  if (stale.length) await clearPendingPublish(projectRoot, stale);

  const remoteUrl = (await git(["remote", "get-url", remote]).catch(() => "")).trim();
  return {
    available: true as const,
    git,
    remote,
    remoteBranch,
    branch,
    upstream,
    repoUrl: webUrl(remoteUrl),
    files,
    otherChanges: [...changed].filter((f) => !files.includes(f)).length,
    ahead: Number(aheadRaw) || 0,
    behind: Number(behindRaw) || 0,
    fetched,
  };
}

export async function publishStatus(projectRoot: string): Promise<PublishStatus> {
  const info = await inspect(projectRoot, { fetch: true });
  if (!info.available) return info;
  const { git: _git, remote: _remote, remoteBranch: _remoteBranch, ...status } = info;
  void _git; void _remote; void _remoteBranch;
  return status;
}

type Identity = { name: string; email: string };
let tokenOwner: Promise<Identity | null> | undefined;

/**
 * Who hosted commits are made as. Hosts such as Vercel only deploy commits whose author has access
 * to the project, and the people editing in hosted Framekit usually don't. So commits are made as
 * FRAMEKIT_COMMIT_AUTHOR ("Name <email>") or, on GitHub, as the owner of the token that pushes
 * them; the person who published is named in the commit message. Falls back to the publisher.
 */
async function hostedIdentity(publisher: string, repoUrl: string | null): Promise<Identity> {
  const configured = process.env.FRAMEKIT_COMMIT_AUTHOR?.match(/^\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (configured) return { name: configured[1], email: configured[2] };
  const token = process.env.GIT_TOKEN?.trim();
  if (token && repoUrl?.startsWith("https://github.com/")) {
    tokenOwner ??= fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "framekit" },
      signal: AbortSignal.timeout(8000),
    })
      .then(async (res) => {
        const user = res.ok ? ((await res.json()) as { login?: unknown; id?: unknown }) : null;
        // The noreply address is tied to the account whatever its email privacy settings are.
        return user && typeof user.login === "string" && typeof user.id === "number"
          ? { name: user.login, email: `${user.id}+${user.login}@users.noreply.github.com` }
          : null;
      })
      .catch(() => null);
    const owner = await tokenOwner;
    if (owner) return owner;
    tokenOwner = undefined; // try again next time
  }
  return { name: publisher.split("@")[0], email: publisher };
}

/** Locally the repository's own git identity is used and newer upstream commits block publishing. */
export async function publish(projectRoot: string, message: string, options: PublishOptions = {}): Promise<PublishResult> {
  const publisher = options.publisher ?? null;
  const info = await inspect(projectRoot, { fetch: true });
  if (!info.available) throw new SessionError(info.reason, "PUBLISH_UNAVAILABLE", 409);
  const { git, files, branch, upstream, remote, remoteBranch } = info;
  if (info.behind > 0 && !options.sync) {
    throw new SessionError(
      `${upstream} has ${info.behind} commit${info.behind === 1 ? "" : "s"} you don't have locally. Pull first (git pull), reload the project, then publish.`,
      "PUBLISH_BEHIND",
      409,
    );
  }
  if (files.length === 0 && info.ahead === 0) throw new SessionError("Nothing to publish. Save your edits first.", "PUBLISH_EMPTY", 409);

  // Author and committer both, so a later rebase keeps them.
  const who = publisher ? await hostedIdentity(publisher, info.repoUrl) : null;
  const env = who ? { GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email } : undefined;

  let sha: string | null = null;
  if (files.length) {
    const subject = message.trim() || defaultMessage(files);
    try {
      await git(["add", "--", ...files]);
      // `--only` semantics: commit exactly these paths even if other changes are staged.
      const credit = publisher && who?.email !== publisher ? ["-m", `Published by ${publisher} with Framekit.`] : [];
      await git(["commit", "--only", "-m", subject, ...credit, "--", ...files], { timeout: 120_000, env });
    } catch (error) {
      throw new SessionError(`Couldn't commit: ${(error as Error).message}`, "PUBLISH_COMMIT_FAILED", 500);
    }
    sha = (await git(["rev-parse", "HEAD"])).trim();
    await clearPendingPublish(projectRoot, files);
  }

  // Hosted: put our commits on top of the newer upstream ones, keeping any other uncommitted work.
  let synced = false;
  if (info.behind > 0) {
    synced = (await git(["diff", "--name-only", "HEAD...@{u}", "--", "."])).trim() !== "";
    try {
      await git(["rebase", "--autostash", "@{u}"], { timeout: 120_000, env });
    } catch {
      await git(["rebase", "--abort"]).catch(() => {});
      throw new SessionError(
        "Your edits are saved, but they overlap with newer changes someone else made to the site, so they can't be published automatically. Ask a developer to combine them.",
        "PUBLISH_CONFLICT",
        409,
      );
    }
    if (sha) sha = (await git(["rev-parse", "HEAD"])).trim();
  }

  try {
    await git(["push", remote, `HEAD:refs/heads/${remoteBranch}`], { timeout: 120_000 });
  } catch (error) {
    throw new SessionError(
      `${sha ? `Committed ${sha.slice(0, 7)} locally, but the push failed` : "The push failed"}: ${(error as Error).message}. Fix the problem and choose Publish again to push it.`,
      "PUBLISH_PUSH_FAILED",
      502,
    );
  }

  return {
    sha,
    branch,
    upstream,
    commitUrl: sha && info.repoUrl ? `${info.repoUrl}/commit/${sha}` : null,
    files,
    pushedCommits: info.ahead + (sha ? 1 : 0),
    synced,
  };
}

export function defaultMessage(files: string[]): string {
  const names = files.map((f) => f.split("/").pop());
  const list = names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return `Update ${list} (Framekit)`;
}

/** git@github.com:owner/repo.git or https://github.com/owner/repo.git -> https://github.com/owner/repo */
function webUrl(remote: string): string | null {
  const ssh = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  const https = remote.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/);
  const match = ssh ?? https;
  if (!match) return null;
  const [, host, repoPath] = match;
  if (!/github\.com|gitlab\.com|bitbucket\.org/.test(host)) return null;
  return `https://${host}/${repoPath}`;
}
