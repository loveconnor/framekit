/** Messages exchanged with the preview bridge (lib/preview/bridge-script.js). */

import type { RenderedLevel } from "./text-segment";

export type Rect = { x: number; y: number; width: number; height: number };
export type Target = { id: string; instance: number; rect: Rect; tag?: string };

export type TreeNode = { id: string; instance: number; tag: string; text: string; children: TreeNode[] };

export type BridgeToEditor =
  | { type: "ready"; path: string }
  | { type: "hover"; target: Target | null }
  | { type: "select"; target: Target | null }
  | { type: "dblclick"; id: string; instance: number }
  | { type: "contextmenu"; id: string; instance: number; x: number; y: number; rect: Rect }
  | { type: "tree"; tree: TreeNode; path: string }
  | {
      type: "rects";
      selected: (Target & { display: string }) | null;
      hovered: Target | null;
      scroll: { x: number; y: number };
      viewport: { width: number; height: number };
    }
  | { type: "selection-lost" }
  | { type: "computed"; id: string; instance: number; styles: Record<string, string>; size: { width: number; height: number }; texts?: RenderedLevel[]; pieces?: string[] }
  | { type: "text-commit"; id: string; instance: number; value: string }
  | { type: "text-cancel"; id: string }
  | { type: "navigate"; path: string }
  | { type: "key"; key: string; meta: boolean; shift: boolean }
  | { type: "style-check"; id: string; property: string; value: string; applied: boolean | null };

export type EditorToBridge =
  | { type: "mode"; mode: "edit" | "preview" }
  | { type: "select"; id: string | null; instance?: number; scroll?: boolean }
  | { type: "hover"; id: string | null; instance?: number }
  | { type: "css"; css: string }
  | { type: "set-style-attr"; id: string; styleId: string }
  | { type: "set-text"; id: string; value: string }
  | { type: "set-attr"; id: string; name: string; value: string | null }
  | { type: "edit-text"; id: string; instance: number }
  | { type: "stop-edit"; commit?: boolean }
  | { type: "request-tree" }
  | { type: "request-computed"; id: string; instance: number }
  | { type: "check-style"; id: string; instance: number; property: string; value: string }
  | { type: "navigate"; path: string }
  | { type: "reload"; waitForText?: string };

export class BridgeClient {
  private listeners = new Set<(message: BridgeToEditor) => void>();
  private frame: HTMLIFrameElement | null = null;
  private origin: string | null = null;
  private onMessage = (event: MessageEvent) => {
    if (!this.origin || event.origin !== this.origin) return;
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    const data = event.data as { fk?: boolean } & BridgeToEditor;
    if (!data || data.fk !== true || typeof data.type !== "string") return;
    for (const listener of this.listeners) listener(data);
  };

  attach(frame: HTMLIFrameElement, previewUrl: string) {
    this.frame = frame;
    this.origin = new URL(previewUrl).origin;
    window.addEventListener("message", this.onMessage);
  }

  detach() {
    window.removeEventListener("message", this.onMessage);
    this.frame = null;
  }

  subscribe(listener: (message: BridgeToEditor) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(message: EditorToBridge) {
    if (!this.frame?.contentWindow || !this.origin) return;
    this.frame.contentWindow.postMessage({ fk: true, ...message }, this.origin);
  }
}

export const bridge = new BridgeClient();
