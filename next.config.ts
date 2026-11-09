import type { NextConfig } from "next";

/**
 * Framekit edits files on this machine, so only its own pages and the origins listed in
 * FRAMEKIT_EMBED_ORIGINS (e.g. a site's admin dashboard with an "Edit Site" tab) may frame it.
 */
const embedOrigins = (process.env.FRAMEKIT_EMBED_ORIGINS ?? "")
  .split(/[\s,]+/)
  .filter((origin) => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin));

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${embedOrigins.join(" ")}`.trim() }],
      },
    ];
  },
  // Framekit is a development tool; Next's own dev badge would sit on top of the canvas.
  devIndicators: false,
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
