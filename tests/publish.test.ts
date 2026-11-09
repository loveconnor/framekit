import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tmp: string;
let remote: string;
let clone: string;
let other: string;
let project: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framekit-publish-")));
  process.env.FRAMEKIT_HOME = path.join(tmp, "home");
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Test";
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "test@example.com";
  remote = path.join(tmp, "remote.git");
  clone = path.join(tmp, "clone");
  other = path.join(tmp, "other");
  git(tmp, "init", "--bare", "-b", "main", remote);
  git(tmp, "clone", remote, clone);
  // The site lives in a subfolder, like a monorepo package.
  project = path.join(clone, "site");
  await fs.mkdir(path.join(project, "app"), { recursive: true });
  await fs.writeFile(path.join(project, "app/page.tsx"), "export default function P() { return <h1>One</h1>; }\n");
  await fs.writeFile(path.join(clone, "README.md"), "hi\n");
  git(clone, "add", "-A");
  git(clone, "commit", "-m", "init");
  git(clone, "push", "-u", "origin", "main");
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("publish", () => {
  it("commits only Framekit-saved files and pushes them", async () => {
    const { addPendingPublish } = await import("@/lib/filesystem/config-store");
    const { publish, publishStatus } = await import("@/lib/project/publish");

    await fs.writeFile(path.join(project, "app/page.tsx"), "export default function P() { return <h1>Two</h1>; }\n");
    await fs.mkdir(path.join(project, "framekit"), { recursive: true });
    await fs.writeFile(path.join(project, "framekit/styles.css"), ".a{color:red}\n"); // new, untracked
    await fs.writeFile(path.join(project, "notes.txt"), "user's own work\n"); // not Framekit's
    await fs.writeFile(path.join(clone, "README.md"), "edited outside the project\n");
    await addPendingPublish(project, ["app/page.tsx", "framekit/styles.css"]);

    const status = await publishStatus(project);
    expect(status).toMatchObject({ available: true, branch: "main", upstream: "origin/main", files: ["app/page.tsx", "framekit/styles.css"], otherChanges: 1, ahead: 0, behind: 0, fetched: true });

    const result = await publish(project, "Edit hero");
    expect(result.files).toEqual(["app/page.tsx", "framekit/styles.css"]);
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("Edit hero");
    expect(git(remote, "show", "--name-only", "--format=", "main").split("\n").sort()).toEqual(["site/app/page.tsx", "site/framekit/styles.css"]);
    // The user's own changes stay uncommitted.
    expect(git(clone, "status", "--porcelain")).toContain("notes.txt");
    expect(git(clone, "status", "--porcelain")).toContain("README.md");

    const after = await publishStatus(project);
    expect(after).toMatchObject({ available: true, files: [], ahead: 0 });
  });

  it("refuses to publish when the remote has commits the user doesn't", async () => {
    const { addPendingPublish } = await import("@/lib/filesystem/config-store");
    const { publish, publishStatus } = await import("@/lib/project/publish");

    git(tmp, "clone", remote, other);
    await fs.writeFile(path.join(other, "CHANGELOG.md"), "teammate\n");
    git(other, "add", "-A");
    git(other, "commit", "-m", "teammate change");
    git(other, "push");

    await fs.writeFile(path.join(project, "app/page.tsx"), "export default function P() { return <h1>Three</h1>; }\n");
    await addPendingPublish(project, ["app/page.tsx"]);
    expect(await publishStatus(project)).toMatchObject({ behind: 1, files: ["app/page.tsx"] });
    await expect(publish(project, "")).rejects.toMatchObject({ code: "PUBLISH_BEHIND" });
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("teammate change");
  });

  it("pushes local commits too after pulling, and reports them", async () => {
    const { publish } = await import("@/lib/project/publish");
    git(clone, "stash", "--include-untracked");
    git(clone, "pull", "--rebase");
    git(clone, "stash", "pop");
    await fs.writeFile(path.join(clone, "LOCAL.md"), "local\n");
    git(clone, "add", "LOCAL.md");
    git(clone, "commit", "-m", "local commit");

    const result = await publish(project, "");
    expect(result.pushedCommits).toBe(2);
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("Update page.tsx (Framekit)");
    expect(git(remote, "log", "-2", "--format=%s", "main").split("\n")[1]).toBe("local commit");
  });

  it("explains when there's no repository", async () => {
    const { publishStatus } = await import("@/lib/project/publish");
    const loose = path.join(tmp, "loose");
    await fs.mkdir(loose);
    expect(await publishStatus(loose)).toMatchObject({ available: false });
  });
});
