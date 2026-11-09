"use client";

import * as React from "react";
import { useEditor } from "@/store/editor-store";
import { bridge } from "@/lib/client/bridge";
import { effectiveOverride, rulesFor } from "@/lib/client/style-utils";
import type { ElementInfo } from "@/types/elements";
import type { OverrideState } from "./controls";

/** Everything a style section needs to read and write one element's styles at the active breakpoint. */
export function useStyleEditor(info: ElementInfo | undefined) {
  const viewport = useEditor((s) => s.viewport);
  const styles = useEditor((s) => s.styles);
  const computed = useEditor((s) => s.computed);
  const styleChecks = useEditor((s) => s.styleChecks);
  const selected = useEditor((s) => s.selected);
  const runCommand = useEditor((s) => s.runCommand);
  const rules = rulesFor(styles, info?.styleId ?? null);

  const value = React.useCallback(
    (property: string): string | null => (info ? (effectiveOverride(rules, viewport, property)?.value ?? null) : null),
    [rules, viewport, info],
  );

  const override = React.useCallback(
    (property: string): OverrideState => {
      const found = effectiveOverride(rules, viewport, property);
      if (!found) return { kind: "none" };
      return found.from === viewport ? { kind: "here", breakpoint: viewport } : { kind: "inherited", breakpoint: found.from };
    },
    [rules, viewport],
  );

  const set = React.useCallback(
    (property: string, next: string | null) => {
      if (!info || !selected) return;
      const groupKey = `style:${info.id}:${viewport}:${property}`;
      void runCommand({ type: "SET_STYLE", nodeId: info.id, breakpoint: viewport, property, value: next }, { groupKey, keepSelection: true }).then((result) => {
        if (!result) return;
        const updated = result.elements.find((e) => e.id === info.id);
        if (updated?.styleId && updated.styleId !== info.styleId) bridge.send({ type: "set-style-attr", id: info.id, styleId: updated.styleId });
        bridge.send({ type: "css", css: result.css });
        if (next !== null) {
          setTimeout(() => bridge.send({ type: "check-style", id: info.id, instance: selected.instance, property, value: next }), 500);
        } else {
          useEditor.setState((s) => {
            const checks = { ...s.styleChecks };
            delete checks[property];
            return { styleChecks: checks };
          });
        }
      });
    },
    [info, selected, viewport, runCommand],
  );

  const conflict = React.useCallback((property: string) => styleChecks[property] === false && value(property) !== null, [styleChecks, value]);

  return { viewport, computed, value, override, set, conflict, rules };
}
