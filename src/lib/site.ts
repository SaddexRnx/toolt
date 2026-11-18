/**
 * Canonical origin of the deployed app.
 *
 * Set `VITE_SITE_URL` when building for production, for example:
 *
 *   VITE_SITE_URL=https://toolt.example.com bun run build
 *
 * Without it the app still works; only absolute SEO URLs (canonical links,
 * Open Graph, JSON-LD and the sitemap) fall back to the local dev origin.
 */
const configured = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();

export const SITE_URL = (configured || "http://localhost:8080").replace(/\/+$/, "");

export function siteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
