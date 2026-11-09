import { test, expect, type Page, type FrameLocator } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const FIXTURE = path.resolve(__dirname, "../../fixtures/marketing-site");
const REPO_MODULES = path.resolve(__dirname, "../../node_modules");

let projectDir: string;

test.beforeAll(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "framekit-e2e-"));
  await fs.cp(FIXTURE, projectDir, { recursive: true, filter: (src) => !/node_modules|\.next/.test(src) });
  await fs.symlink(REPO_MODULES, path.join(projectDir, "node_modules"), "dir");
});

test.afterAll(async () => {
  await fetch("http://127.0.0.1:3000/api/projects/close", { method: "POST" }).catch(() => undefined);
  await fetch("http://127.0.0.1:3000/api/projects/recent", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: projectDir }),
  }).catch(() => undefined);
  if (projectDir) await fs.rm(projectDir, { recursive: true, force: true });
});

async function openFixture(page: Page): Promise<FrameLocator> {
  await page.goto("/");
  await page.getByLabel("Project directory").fill(projectDir);
  await page.getByRole("button", { name: "Open project" }).click();
  await page.waitForURL("**/editor");
  const frame = page.frameLocator("iframe[title='Website preview']");
  await frame.locator("h1").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1500);
  return frame;
}

test("opens a project, edits content and styles, undoes, saves to source", async ({ page }) => {
  const frame = await openFixture(page);

  // Select the hero heading on the canvas; Layers and the inspector follow.
  await frame.locator("h1").click();
  await expect(page.locator("aside[aria-label='Inspector'] h2")).toHaveText("H1 Heading");
  await expect(page.locator("[role=treeitem][aria-selected=true]")).toContainText("H1 Heading");

  // Text edit through the inspector reaches the preview.
  const text = page.locator("#fk-text");
  await text.fill("Hello from Framekit");
  await text.press("Enter");
  await expect(frame.locator("h1")).toHaveText("Hello from Framekit");

  // Desktop font size, then a mobile override that does not disturb desktop.
  const fontSize = page.getByLabel("Font size", { exact: true });
  await fontSize.fill("64");
  await fontSize.press("Enter");
  await expect.poll(() => frame.locator("h1").evaluate((el) => getComputedStyle(el).fontSize)).toBe("64px");
  await page.getByLabel("Mobile, 390px").click();
  await fontSize.fill("36");
  await fontSize.press("Enter");
  await expect.poll(() => frame.locator("h1").evaluate((el) => getComputedStyle(el).fontSize)).toBe("36px");
  await page.getByLabel("Desktop", { exact: true }).click();
  await expect.poll(() => frame.locator("h1").evaluate((el) => getComputedStyle(el).fontSize)).toBe("64px");

  // Undo the mobile override and the desktop size, then redo the desktop size.
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => frame.locator("h1").evaluate((el) => getComputedStyle(el).fontSize)).toBe("48px");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(() => frame.locator("h1").evaluate((el) => getComputedStyle(el).fontSize)).toBe("64px");

  // The hero button's href is a component prop: shown read-only, never hardcoded.
  await frame.locator("a", { hasText: "Start a project" }).first().click();
  await expect(page.locator("aside[aria-label='Inspector'] h2")).toHaveText("Link");
  await expect(page.locator("aside[aria-label='Inspector']")).toContainText("Shared source");
  await expect(page.locator("#fk-href")).toHaveCount(0);
  await expect(page.locator("aside[aria-label='Inspector']")).toContainText("{href}");

  // The header's About link has a static href, inside a shared header.
  await frame.locator("nav a", { hasText: "About" }).click();
  await expect(page.locator("aside[aria-label='Inspector'] h2")).toHaveText("Link");
  const href = page.locator("#fk-href");
  await href.fill("/hello");
  await href.press("Enter");
  await expect(frame.locator("nav a", { hasText: "About" })).toHaveAttribute("href", "/hello");

  // Add a paragraph inside the hero section and delete it again with the keyboard.
  await page.locator("[role=treeitem]", { hasText: "Section" }).first().click();
  await page.getByRole("tab", { name: "Add" }).click();
  await page.getByRole("button", { name: /Paragraph/ }).click();
  await expect(frame.locator("p", { hasText: "Write something here." })).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expect(frame.locator("p", { hasText: "Write something here." })).toHaveCount(0);

  // Save and verify the original project changed, without any preview instrumentation.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("footer")).toContainText("No unsaved changes");
  const pageSource = await fs.readFile(path.join(projectDir, "app/page.tsx"), "utf8");
  expect(pageSource).toContain("Hello from Framekit");
  expect(pageSource).toContain('data-fk-style="fk-');
  expect(pageSource).not.toContain("data-fk-id");
  expect(pageSource).toContain("services.map((service) =>");
  const buttonSource = await fs.readFile(path.join(projectDir, "components/button.tsx"), "utf8");
  expect(buttonSource).toContain("Link");
  const headerSource = await fs.readFile(path.join(projectDir, "components/header.tsx"), "utf8");
  expect(headerSource).toContain('href="/hello"');
  const css = await fs.readFile(path.join(projectDir, "framekit/styles.css"), "utf8");
  expect(css).toContain("font-size: 64px");
  expect(css).not.toContain("767px");
  const layout = await fs.readFile(path.join(projectDir, "app/layout.tsx"), "utf8");
  expect(layout).toContain('import "../framekit/styles.css";');

  // The saved project still type-checks on its own.
  const tsc = spawnSync("npx", ["tsc", "--noEmit", "-p", projectDir], { cwd: projectDir, encoding: "utf8" });
  expect(tsc.status, tsc.stdout + tsc.stderr).toBe(0);
});

test("preview mode lets links navigate and switching pages updates the canvas", async ({ page }) => {
  const frame = await openFixture(page);
  await page.getByRole("button", { name: "Preview" }).click();
  await frame.locator("nav a", { hasText: "Journal" }).click();
  await expect(frame.locator("h1")).toHaveText("launch");
  await expect(page.locator("header")).toContainText("/blog/launch");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Select page").click();
  await page.getByRole("option", { name: /Home/ }).click();
  await expect(frame.locator("h1")).toHaveText(/Design for|Hello from Framekit/);
});
