import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Vite + TanStack Start + Tailwind. The production build is emitted by nitro
// for Cloudflare Workers (`.output/`); the dev server stays a plain Vite server.
export default defineConfig(({ command }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  // One React instance only - mixing React copies breaks hooks at runtime.
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Use src/server.ts as the SSR entry (security headers + error page).
      server: { entry: "server" },
    }),
    // Nitro only builds; the dev server runs on Vite directly.
    ...(command === "build" ? [nitro({ preset: "cloudflare-module" })] : []),
    viteReact(),
  ],
}));
