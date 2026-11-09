import { useEditor } from "@/store/editor-store";

export type KeyInput = { key: string; meta: boolean; shift: boolean; inTextField: boolean };

/** Shared by the editor window and key events forwarded from the preview bridge. */
export function handleEditorKey(input: KeyInput): boolean {
  const state = useEditor.getState();
  const { key, meta, shift, inTextField } = input;
  const lower = key.toLowerCase();

  if (meta && lower === "s") {
    void state.save();
    return true;
  }
  if (meta && lower === "z") {
    if (inTextField) return false;
    if (shift) void state.redo();
    else void state.undo();
    return true;
  }
  if (meta && shift && lower === "p") {
    state.setMode(state.mode === "edit" ? "preview" : "edit");
    return true;
  }
  if (inTextField) return false;
  if (state.mode !== "edit") return false;

  if (key === "Escape") {
    if (state.contextMenu) state.setContextMenu(null);
    else state.select(null);
    return true;
  }
  if (key === "Delete" || key === "Backspace") {
    if (state.inlineEditing) return false;
    state.deleteSelected();
    return true;
  }
  if (meta && lower === "d") {
    state.duplicateSelected();
    return true;
  }
  if (key === "Enter" && state.selected && !state.inlineEditing) {
    state.startInlineEdit();
    return true;
  }
  return false;
}

export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
