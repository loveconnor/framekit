"use client";

import * as React from "react";
import {
  Square, RectangleHorizontal, LayoutGrid, Columns2, PanelTop, PanelBottom, Menu,
  Heading, Pilcrow, Type, Quote, List, ListPlus,
  MousePointerClick, Link, Minus, StretchVertical,
  Image, Video,
  FileInput, Tag, TextCursorInput, Rows3,
  Search, X,
} from "honestui/icons";
import { useEditor } from "@/store/editor-store";
import type { AddableElement } from "@/types/elements";
import { ELEMENT_CATALOG, ELEMENT_GROUPS } from "@/lib/source/element-catalog";
import { labelForTag } from "@/lib/source/labels";
import { cn } from "@/lib/utils";

type Icon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

const ICONS: Record<AddableElement, Icon> = {
  section: RectangleHorizontal,
  container: Square,
  grid: LayoutGrid,
  flex: Columns2,
  header: PanelTop,
  footer: PanelBottom,
  nav: Menu,
  heading: Heading,
  paragraph: Pilcrow,
  text: Type,
  quote: Quote,
  list: List,
  "list-item": ListPlus,
  button: MousePointerClick,
  link: Link,
  divider: Minus,
  spacer: StretchVertical,
  image: Image,
  video: Video,
  form: FileInput,
  label: Tag,
  input: TextCursorInput,
  textarea: Rows3,
};

export function AddPanel() {
  const selected = useEditor((s) => s.selected);
  const info = useEditor((s) => (s.selected ? s.elements[s.selected.id] : undefined));
  const addElement = useEditor((s) => s.addElement);
  const phase = useEditor((s) => s.phase);
  const [placement, setPlacement] = React.useState<"inside" | "after">("inside");
  const [query, setQuery] = React.useState("");

  const insideOk = info?.ops.addInside.allowed ?? false;
  const afterOk = info?.ops.addAfter.allowed ?? false;
  const effective = selected ? (placement === "inside" && !insideOk && afterOk ? "after" : placement === "after" && !afterOk && insideOk ? "inside" : placement) : "inside";
  const canAdd = phase === "ready" && (!selected || insideOk || afterOk);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? ELEMENT_CATALOG.filter((e) => e.label.toLowerCase().includes(needle) || e.description.toLowerCase().includes(needle) || e.type.includes(needle))
    : ELEMENT_CATALOG;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-fk-border px-3 py-3">
        {selected && info ? (
          <>
            <p className="text-[11px] text-fk-text-muted">Add relative to</p>
            <p className="truncate text-[12px] font-medium text-fk-text">{labelForTag(info.tag)}</p>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-fk-raised p-0.5" role="radiogroup" aria-label="Placement">
              {(["inside", "after"] as const).map((option) => {
                const ok = option === "inside" ? insideOk : afterOk;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={effective === option}
                    disabled={!ok}
                    title={!ok ? (option === "inside" ? info.ops.addInside.reason : info.ops.addAfter.reason) : undefined}
                    onClick={() => setPlacement(option)}
                    className={cn(
                      "h-6 rounded text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:text-fk-text-faint",
                      effective === option ? "bg-fk-panel text-fk-text shadow-[0_1px_2px_rgba(0,0,0,0.05)]" : "text-fk-text-muted hover:text-fk-text",
                    )}
                  >
                    {option === "inside" ? "Inside" : "After"}
                  </button>
                );
              })}
            </div>
            {!insideOk && !afterOk && <p className="mt-2 text-[11px] leading-4 text-fk-text-muted">{info.ops.addAfter.reason}</p>}
          </>
        ) : (
          <p className="text-[11px] leading-4 text-fk-text-muted">Nothing selected. New elements go at the end of the main content area. Select a container to place them precisely.</p>
        )}
      </div>

      <div className="shrink-0 border-b border-fk-border px-3 py-2">
        <div className="flex h-7 items-center gap-2 rounded-[4px] border border-fk-border bg-fk-panel px-2 transition-[border-color,box-shadow] duration-[var(--hui-duration-fast)] ease-[var(--hui-ease-out)] focus-within:border-fk-accent focus-within:shadow-[0_0_0_1px_var(--fk-accent)]">
          <Search className="size-3.5 shrink-0 text-fk-text-faint" strokeWidth={1.5} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an element"
            aria-label="Find an element"
            className="h-full min-w-0 flex-1 bg-transparent text-[11px] text-fk-text outline-none placeholder:text-fk-text-faint [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-fk-text-faint hover:text-fk-text">
              <X className="size-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 fk-scroll">
        {visible.length === 0 && <p className="pt-4 text-[11px] text-fk-text-muted">No elements match</p>}
        {ELEMENT_GROUPS.map((group) => {
          const items = visible.filter((e) => e.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group} aria-label={group} className="pt-4 first:pt-2">
              <h3 className="mb-2 text-[11px] font-medium text-fk-text-muted">{group}</h3>
              <ul className="grid grid-cols-3 gap-1">
                {items.map((item) => {
                  const ItemIcon = ICONS[item.type];
                  return (
                    <li key={item.type}>
                      <button
                        type="button"
                        disabled={!canAdd}
                        title={item.description}
                        onClick={() => addElement(item.type, effective)}
                        className={cn(
                          "group flex h-16 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-transparent bg-fk-raised px-1 text-center",
                          "transition-[background-color,border-color,color] duration-[var(--hui-duration-fast)] ease-[var(--hui-ease-out)]",
                          "hover:border-fk-border-strong hover:bg-fk-panel focus-visible:border-fk-accent focus-visible:outline-none",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                      >
                        <ItemIcon className="size-[18px] text-fk-text-secondary transition-colors group-hover:text-fk-text" strokeWidth={1.5} />
                        <span className="w-full truncate text-[11px] leading-4 text-fk-text">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
