import { z } from "zod";
import { ADDABLE_ELEMENTS } from "@/types/elements";

const nodeId = z.string().min(1).max(200).regex(/^[a-z0-9]+:[0-9.]+$/, "Invalid element id");
const breakpoint = z.enum(["desktop", "tablet", "mobile"]);
const cssProperty = z.string().min(1).max(40).regex(/^[a-z-]+$/);
const cssValue = z.string().max(200);

export const EditCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SET_TEXT"), nodeId, value: z.string().max(20_000) }),
  z.object({
    type: z.literal("SET_ATTRIBUTE"),
    nodeId,
    name: z.string().regex(/^[a-zA-Z-]+$/).max(40),
    value: z.union([z.string().max(2_000), z.boolean(), z.null()]),
  }),
  z.object({ type: z.literal("SET_STYLE"), nodeId, breakpoint, property: cssProperty, value: cssValue.nullable() }),
  z.object({ type: z.literal("SET_TAG"), nodeId, tag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]) }),
  z.object({
    type: z.literal("ADD_NODE"),
    targetId: nodeId,
    placement: z.enum(["inside", "after"]),
    elementType: z.enum(ADDABLE_ELEMENTS),
  }),
  z.object({ type: z.literal("DELETE_NODE"), nodeId }),
  /** Edit text that reaches the page through code, at the string literal that produces it. */
  z.object({
    type: z.literal("SET_SOURCE_TEXT"),
    file: z.string().min(1).max(500),
    loc: z.string().regex(/^\d+:\d+$/),
    expected: z.string().max(20_000),
    value: z.string().max(20_000),
  }),
  z.object({ type: z.literal("DUPLICATE_NODE"), nodeId }),
  z.object({ type: z.literal("MOVE_NODE"), nodeId, targetParentId: nodeId, position: z.number().int().min(0).max(10_000) }),
]);

export type EditCommand = z.infer<typeof EditCommandSchema>;

export const CommandRequestSchema = z.object({
  command: EditCommandSchema,
  expectedRevision: z.number().int().nonnegative().optional(),
  /** Consecutive commands sharing a group key collapse into one undo entry (typing). */
  groupKey: z.string().max(200).optional(),
});

export type CommandRequest = z.infer<typeof CommandRequestSchema>;
