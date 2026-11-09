"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

/** Pick an image from the project's public/ folder. Renders its own trigger button. */
export function AssetPicker({ onPick, previewUrl, label = "From project", className }: { onPick: (path: string) => void; previewUrl: string | null; label?: string; className?: string }) {
  const [assets, setAssets] = React.useState<string[] | null>(null);
  const [open, setOpen] = React.useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !assets) void api.assets().then((r) => setAssets(r.images)).catch(() => setAssets([]));
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" className={cn("h-6 w-full text-[11px]", className)} />}>{label}</PopoverTrigger>
      <PopoverPopup side="left" align="start" className="w-64 p-2">
        <p className="px-1 pb-2 text-[11px] text-fk-text-muted">Images in public/</p>
        <ul className="grid max-h-64 grid-cols-3 gap-1 overflow-y-auto fk-scroll">
          {assets === null && <li className="col-span-3 px-1 py-2 text-[11px] text-fk-text-muted">Loading</li>}
          {assets?.length === 0 && <li className="col-span-3 px-1 py-2 text-[11px] text-fk-text-muted">No images found</li>}
          {assets?.map((asset) => (
            <li key={asset}>
              <button
                type="button"
                title={asset}
                onClick={() => {
                  onPick(asset);
                  setOpen(false);
                }}
                className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-fk-border bg-[repeating-conic-gradient(#f0f0f0_0_25%,#fff_0_50%)] bg-[length:10px_10px] hover:border-fk-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl ? `${previewUrl}${asset}` : asset} alt={asset} className="max-h-full max-w-full object-contain" />
              </button>
            </li>
          ))}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}
