import * as t from "@babel/types";
import type { Node } from "@babel/types";

export type Visit = (node: Node, ancestors: Node[]) => void | false;

/**
 * Depth-first walk over a Babel AST using VISITOR_KEYS. `ancestors` is the chain from the
 * root to the parent of `node`, nearest last. Returning `false` from the visitor skips children.
 */
export function walk(root: Node, visit: Visit): void {
  const stack: Node[] = [];
  const recurse = (node: Node): void => {
    const result = visit(node, stack);
    if (result === false) return;
    const keys = t.VISITOR_KEYS[node.type];
    if (!keys) return;
    stack.push(node);
    for (const key of keys) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof (item as Node).type === "string") recurse(item as Node);
        }
      } else if (child && typeof (child as Node).type === "string") {
        recurse(child as Node);
      }
    }
    stack.pop();
  };
  recurse(root);
}
