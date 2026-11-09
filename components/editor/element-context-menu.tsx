"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Copy, Trash2, CornerDownRight, ArrowDown, Hash } from "honestui/icons";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { useEditor } from "@/store/editor-store";
import { labelForTag } from "@/lib/source/labels";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/** One menu for both the canvas and the Layers panel, opened at pointer coordinates. */
export function ElementContextMenu() {
  const menu = useEditor((s) => s.contextMenu);
  const setContextMenu = useEditor((s) => s.setContextMenu);
  const info = useEditor((s) => (menu ? s.elements[menu.id] : undefined));
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const setLeftPanel = useEditor((s) => s.setLeftPanel);

  const anchor = React.useMemo(() => {
    if (!menu) return null;
    const rect = { x: menu.x, y: menu.y, width: 0, height: 0, top: menu.y, left: menu.x, right: menu.x, bottom: menu.y, toJSON: () => ({}) } as DOMRect;
    return { getBoundingClientRect: () => rect };
  }, [menu]);

  const copyPath = () => {
    const { tree, elements, selected } = useEditor.getState();
    if (!tree || !selected) return;
    const path: string[] = [];
    const visit = (node: typeof tree): boolean => {
      const el = elements[node.id];
      path.push(el ? labelForTag(el.tag) : labelForTag(node.tag));
      if (node.id === selected.id && node.instance === selected.instance) return true;
      for (const child of node.children) if (visit(child)) return true;
      path.pop();
      return false;
    };
    if (visit(tree)) {
      void navigator.clipboard.writeText(path.join(" > ")).then(() => toast.info("Element path copied", path.join(" > ")));
    }
  };

  return (
    <MenuPrimitive.Root open={menu !== null} onOpenChange={(open) => !open && setContextMenu(null)} modal={false}>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2} className="z-50">
          <MenuPrimitive.Popup
            className={cn(
              "box-border min-w-48 rounded-[8px] border-[0.5px] border-[var(--hui-color-border-overlay)] bg-[var(--hui-color-background-overlay)] p-1 text-fk-text shadow-[0_8px_24px_rgba(0,0,0,0.08)] outline-none",
              "data-starting-style:opacity-0 data-ending-style:opacity-0 [transition:opacity_120ms_var(--fk-ease)]",
            )}
          >
            {info && (
              <>
                <div className="px-3 py-1.5 text-[11px] text-fk-text-muted">
                  {labelForTag(info.tag)}
                  {info.shared && " · shared"}
                </div>
                <MenuItem disabled={!info.ops.duplicate.allowed} onClick={duplicateSelected} title={info.ops.duplicate.reason}>
                  <Copy strokeWidth={1.5} /> Duplicate
                  <span className="ml-auto text-[11px] text-fk-text-faint">⌘D</span>
                </MenuItem>
                <MenuItem disabled={!info.ops.addInside.allowed} onClick={() => setLeftPanel("add")} title={info.ops.addInside.reason}>
                  <CornerDownRight strokeWidth={1.5} /> Add inside
                </MenuItem>
                <MenuItem disabled={!info.ops.addAfter.allowed} onClick={() => setLeftPanel("add")} title={info.ops.addAfter.reason}>
                  <ArrowDown strokeWidth={1.5} /> Add after
                </MenuItem>
                <MenuItem onClick={copyPath}>
                  <Hash strokeWidth={1.5} /> Copy element path
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" disabled={!info.ops.delete.allowed} onClick={deleteSelected} title={info.ops.delete.reason}>
                  <Trash2 strokeWidth={1.5} /> Delete
                  <span className="ml-auto text-[11px] text-fk-text-faint">⌫</span>
                </MenuItem>
              </>
            )}
            {!info && <div className="px-3 py-2 text-[12px] text-fk-text-muted">Framekit couldn&apos;t identify the source for this element.</div>}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
