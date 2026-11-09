"use client";

import * as React from "react";
import { Upload, Image as ImageIcon } from "honestui/icons";
import type { ElementInfo } from "@/types/elements";
import { useEditor } from "@/store/editor-store";
import { bridge } from "@/lib/client/bridge";
import { api, ApiError } from "@/lib/client/api";
import { flattenLevels, locateSegment, type RenderedLevel, type Segment } from "@/lib/client/text-segment";
import { toast } from "@/components/ui/toaster";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { AssetPicker } from "./asset-picker";
import { InspectorSection, PropertyRow, CommitInput, SelectControl, Notice } from "./controls";

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => ({ value: h, label: `${h.toUpperCase()} Heading` }));
const BUTTON_TYPES = [
  { value: "button", label: "Button" },
  { value: "submit", label: "Submit" },
  { value: "reset", label: "Reset" },
];

export function ContentSection({ info }: { info: ElementInfo }) {
  const runCommand = useEditor((s) => s.runCommand);
  const previewUrl = useEditor((s) => s.previewUrl);
  const attr = (name: string) => info.attributes[name];
  const staticValue = (name: string) => {
    const a = attr(name);
    return a?.kind === "static" ? a.value : "";
  };
  const isDynamic = (name: string) => attr(name)?.kind === "dynamic";

  const setText = (value: string) => void runCommand({ type: "SET_TEXT", nodeId: info.id, value }, { groupKey: `text:${info.id}`, keepSelection: true });
  const setAttr = (name: string, value: string | boolean | null) =>
    void runCommand({ type: "SET_ATTRIBUTE", nodeId: info.id, name, value }, { groupKey: `attr:${info.id}:${name}`, keepSelection: true }).then((r) => {
      if (r && typeof value !== "boolean") bridge.send({ type: "set-attr", id: info.id, name, value });
    });

  const renderedLevels = useEditor((s) => s.renderedLevels);
  const renderedPieces = useEditor((s) => s.renderedPieces);
  // Text produced by code (props, translation calls, word-splitting components) may still trace back
  // to one string in the source. Containers only match their own text, never an ancestor's.
  const traceable = info.text.kind === "readonly" || (info.text.kind === "none" && !VOID_LIKE.has(info.tag));
  const traceLevels = traceable && renderedLevels[0]?.raw ? (info.text.kind === "none" ? renderedLevels.slice(0, 1) : renderedLevels) : [];

  const isLink = info.tag === "a";
  const isImage = info.tag === "img";
  const isButton = info.tag === "button";
  const hasContent = info.text.kind !== "none" || isLink || isImage || isButton || info.ops.setTag.allowed;
  // An element with no text of its own gets a Content section only if its text traces to a source string.
  if (!hasContent) return traceLevels.length > 0 ? <SourceText key={info.id} elementId={info.id} levels={traceLevels} pieces={renderedPieces} fallbackReason={null} section /> : null;

  return (
    <InspectorSection title="Content">
      {info.text.kind === "editable" && (
        <PropertyRow label="Text" htmlFor="fk-text" stacked>
          <CommitInput id="fk-text" multiline value={info.text.value} onCommit={setText} onLiveChange={(v) => bridge.send({ type: "set-text", id: info.id, value: v })} placeholder="Empty" />
        </PropertyRow>
      )}
      {traceLevels.length > 0 && (
        <SourceText key={info.id} elementId={info.id} levels={traceLevels} pieces={renderedPieces} fallbackReason={info.text.kind === "readonly" ? info.text.reason : null} preview={info.text.kind === "readonly" ? info.text.preview : undefined} />
      )}
      {info.text.kind === "readonly" && traceLevels.length === 0 && (
        <Notice>
          {info.text.reason}
          {info.text.preview && (
            <>
              {" "}
              <span className="font-mono text-fk-text-muted">{`{${info.text.preview}}`}</span>
            </>
          )}
        </Notice>
      )}
      {info.ops.setTag.allowed && (
        <PropertyRow label="Element">
          <SelectControl ariaLabel="Heading level" value={info.tag} options={HEADINGS} onChange={(tag) => void runCommand({ type: "SET_TAG", nodeId: info.id, tag: tag as "h1" }, { keepSelection: true })} />
        </PropertyRow>
      )}

      {isLink && (
        <>
          <PropertyRow label="Link" htmlFor="fk-href">
            {isDynamic("href") ? (
              <ReadonlyValue value={(attr("href") as { preview: string }).preview} />
            ) : (
              <CommitInput id="fk-href" mono value={staticValue("href")} onCommit={(v) => setAttr("href", v)} placeholder="/page, https://, mailto:" />
            )}
          </PropertyRow>
          {!isDynamic("target") && (
            <PropertyRow label="New tab">
              <div className="flex h-6 items-center">
                <Switch
                  aria-label="Open in new tab"
                  checked={staticValue("target") === "_blank"}
                  onCheckedChange={(checked) => {
                    setAttr("target", checked ? "_blank" : null);
                    if (checked && !staticValue("rel")) setAttr("rel", "noopener noreferrer");
                  }}
                />
              </div>
            </PropertyRow>
          )}
        </>
      )}

      {isButton && !isDynamic("type") && (
        <PropertyRow label="Type">
          <SelectControl ariaLabel="Button type" value={staticValue("type") || "submit"} options={BUTTON_TYPES} onChange={(v) => setAttr("type", v)} />
        </PropertyRow>
      )}

      {isImage && <ImageFields info={info} previewUrl={previewUrl} setAttr={setAttr} staticValue={staticValue} isDynamic={isDynamic} />}
    </InspectorSection>
  );
}

const VOID_LIKE = new Set(["img", "svg", "video", "iframe", "input", "textarea", "select", "hr", "br", "canvas", "picture"]);

type SourceMatch = Awaited<ReturnType<typeof api.textSource>>["matches"][number];

/**
 * Edit text at the source string that produces it, e.g. a translated message passed through a
 * component that splits it into animated words. Mount with a key per selection.
 */
function SourceText({
  elementId,
  levels,
  pieces,
  fallbackReason,
  preview,
  section = false,
}: {
  elementId: string;
  levels: RenderedLevel[];
  pieces: string[];
  fallbackReason: string | null;
  preview?: string;
  /** Render inside its own Content section, and nothing at all when there is no match. */
  section?: boolean;
}) {
  const runCommand = useEditor((s) => s.runCommand);
  const focusRequest = useEditor((s) => s.textFocusRequest);
  const [matches, setMatches] = React.useState<SourceMatch[] | null>(null);
  const [chosen, setChosen] = React.useState(0);
  const [full, setFull] = React.useState(false);
  /** After editing a part, the page still shows the old part until it reloads: remember where it went. */
  const [edited, setEdited] = React.useState<{ forOwn: string; segment: Segment } | null>(null);
  const { texts, origin } = flattenLevels(levels, pieces);
  const own = levels[0]?.raw ?? "";

  // Look up again when the page reports different text, keeping the current match if the new
  // lookup comes back empty (the page may still show the text from before an edit).
  const textsKey = texts.join("\u0000");
  React.useEffect(() => {
    let cancelled = false;
    api
      .textSource(textsKey.split("\u0000"))
      .then((r) => !cancelled && setMatches((current) => (r.matches.length || !current?.length ? r.matches : current)))
      .catch(() => !cancelled && setMatches([]));
    return () => {
      cancelled = true;
    };
  }, [textsKey]);

  // Which string, and which part of it, the field edits. Edit only the selected part when it can be
  // located unambiguously (one word of a heading, the accent of a sentence).
  const match = matches?.[chosen] ?? null;
  const from = match ? origin[match.depth] : undefined;
  // A matched piece is the whole string already (`{name}` of `{name}, {role}`).
  const located = match && from && from.variant !== "piece" ? locateSegment(match.value, own, texts[match.depth] ?? "", levels[from.level]?.occurrence ?? null) : null;
  const segment = full ? null : edited && edited.forOwn === own ? edited.segment : located;
  const shown = match ? (segment ? match.value.slice(segment.start, segment.end) : match.value) : "";

  const commit = (input: string) => {
    if (!match) return;
    const value = segment ? match.value.slice(0, segment.start) + input + match.value.slice(segment.end) : input;
    void runCommand(
      { type: "SET_SOURCE_TEXT", file: match.file, loc: match.loc, expected: match.value, value },
      { groupKey: `source-text:${match.file}:${match.loc}`, keepSelection: true },
    ).then((ok) => {
      if (!ok) return;
      // The literal keeps its position; later edits must expect the new wording.
      setMatches((list) => list?.map((m, i) => (i === chosen ? { ...m, value } : m)) ?? null);
      if (segment) setEdited({ forOwn: own, segment: { start: segment.start, end: segment.start + input.length } });
      // Code-produced text often feeds components that only animate in on mount (word reveals),
      // which hot reloading leaves hidden. A full reload renders it as visitors will see it.
      bridge.send({ type: "reload", waitForText: value });
    });
  };

  // Double-click on the canvas asks for text editing. Edit right on the canvas when the element shows
  // exactly the text being edited; if markup sits inside it (`*accent*`), editing the rendered text
  // would drop the markup, so focus the field instead. With no match, explain why.
  const onEditRequest = React.useEffectEvent(() => {
    useEditor.setState({ textFocusRequest: null });
    const collapse = (v: string) => v.replace(/\s+/g, " ").trim();
    const selected = useEditor.getState().selected;
    if (match && selected?.id === elementId && collapse(shown) === collapse(own)) {
      useEditor.setState({ inlineEditing: true, inlineSource: { id: elementId, commit: (v) => commit(collapse(v)) } });
      bridge.send({ type: "edit-text", id: elementId, instance: selected.instance });
      return;
    }
    const field = document.getElementById("fk-source-text");
    if (field) field.focus();
    else if (fallbackReason) toast.info(fallbackReason);
  });
  React.useEffect(() => {
    if (focusRequest?.id === elementId && matches !== null) onEditRequest();
  }, [focusRequest, matches, elementId]);

  if (matches === null) return null;
  if (!match) {
    if (!fallbackReason) return null;
    return (
      <Notice>
        {fallbackReason}
        {preview && (
          <>
            {" "}
            <span className="font-mono text-fk-text-muted">{`{${preview}}`}</span>
          </>
        )}
      </Notice>
    );
  }

  const body = (
    <>
      <PropertyRow label="Text" htmlFor="fk-source-text" stacked>
        <CommitInput id="fk-source-text" multiline value={shown} onCommit={commit} placeholder="Empty" />
      </PropertyRow>
      {(segment || (full && located)) && (
        <p className="text-[11px] leading-4 text-fk-text-muted">
          {segment ? (
            <>
              Part of <span className="text-fk-text-secondary">“{match.value}”</span>{" · "}
              <button type="button" className="text-fk-accent hover:underline" onClick={() => setFull(true)}>
                Edit full text
              </button>
            </>
          ) : (
            <button type="button" className="text-fk-accent hover:underline" onClick={() => setFull(false)}>
              Edit only the selected part
            </button>
          )}
        </p>
      )}
      <p className="text-[11px] leading-4 text-fk-text-muted">
        From <span className="font-mono">{match.file.split("/").pop()}:{match.line}</span>
        {matches.length > 1 && (
          <>
            {" · "}
            <button type="button" className="text-fk-accent hover:underline" onClick={() => setChosen((chosen + 1) % matches.length)}>
              {matches.length} places use this text, show next
            </button>
          </>
        )}
        {match.translated && <>. Translated text: other languages keep showing this wording until their translations are updated.</>}
      </p>
    </>
  );
  return section ? <InspectorSection title="Content">{body}</InspectorSection> : body;
}

function ReadonlyValue({ value }: { value: string }) {
  return (
    <div className="flex h-6 items-center truncate rounded-[4px] bg-fk-raised px-2 font-mono text-[10.5px] text-fk-text-muted" title="Computed by JavaScript">
      {`{${value}}`}
    </div>
  );
}

function ImageFields({
  info,
  previewUrl,
  setAttr,
  staticValue,
  isDynamic,
}: {
  info: ElementInfo;
  previewUrl: string | null;
  setAttr: (name: string, value: string | null) => void;
  staticValue: (name: string) => string;
  isDynamic: (name: string) => boolean;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const src = staticValue("src");
  const previewSrc = src ? (src.startsWith("/") && previewUrl ? `${previewUrl}${src}` : src) : null;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const next = await api.upload(file);
      setAttr("src", next);
      toast.success("Image replaced", next);
    } catch (error) {
      toast.error("Couldn't replace the image", error instanceof ApiError ? error.message : undefined);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-[4px] border border-fk-border bg-[repeating-conic-gradient(#f0f0f0_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageIcon className="size-5 text-fk-text-faint" strokeWidth={1.5} />
        )}
      </div>
      <PropertyRow label="Source" htmlFor="fk-src">
        {isDynamic("src") ? <ReadonlyValue value={(info.attributes.src as { preview: string }).preview} /> : <CommitInput id="fk-src" mono value={src} onCommit={(v) => setAttr("src", v)} placeholder="/image.png" />}
      </PropertyRow>
      {!isDynamic("src") && (
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" size="sm" className="h-6 w-full text-[11px]" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="size-3.5" strokeWidth={1.5} />
            {uploading ? "Uploading" : "Replace image"}
          </Button>
          <AssetPicker previewUrl={previewUrl} onPick={(path) => setAttr("src", path)} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/avif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </div>
      )}
      <PropertyRow label="Alt text" htmlFor="fk-alt">
        {isDynamic("alt") ? <ReadonlyValue value={(info.attributes.alt as { preview: string }).preview} /> : <CommitInput id="fk-alt" value={staticValue("alt")} onCommit={(v) => setAttr("alt", v)} placeholder="Describe the image" />}
      </PropertyRow>
      {info.source === "next-image" && (
        <>
          <PropertyRow label="Width" htmlFor="fk-w">
            {isDynamic("width") ? <ReadonlyValue value={(info.attributes.width as { preview: string }).preview} /> : <CommitInput id="fk-w" mono value={staticValue("width")} onCommit={(v) => /^\d+$/.test(v) && setAttr("width", v)} />}
          </PropertyRow>
          <PropertyRow label="Height" htmlFor="fk-h">
            {isDynamic("height") ? <ReadonlyValue value={(info.attributes.height as { preview: string }).preview} /> : <CommitInput id="fk-h" mono value={staticValue("height")} onCommit={(v) => /^\d+$/.test(v) && setAttr("height", v)} />}
          </PropertyRow>
        </>
      )}
    </>
  );
}
