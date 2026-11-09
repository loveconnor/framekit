"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { useEffect } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // Embedded in a site's dashboard ("Edit Site"): tell the parent Framekit is running, so it can show
  // the editor instead of setup instructions. Only `frame-ancestors`-allowed origins can embed us.
  useEffect(() => {
    if (window.parent !== window) window.parent.postMessage({ type: "framekit:ready" }, "*");
  }, []);

  return (
    <TooltipProvider delay={400}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
