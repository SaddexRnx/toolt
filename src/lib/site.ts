/**
 * Canonical origin of the deployed app.
 *
 * Production builds default to the live Cloudflare Worker. Set
 * `VITE_SITE_URL` only when deploying to a custom domain.
 *
 * A stale `VITE_SITE_URL=http://localhost:8080` in a hosting provider's
 * build settings is ignored in production so it cannot leak into canonical
 * links, Open Graph tags, JSON-LD or the sitemap.
 */
const DEV_URL = "http://localhost:8080";
const PRODUCTION_URL = "https://toolt.sdxrnx.workers.dev";

const configured = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
const pointsAtLocalhost = configured
  ? /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/i.test(configured)
  : false;

const fallback = import.meta.env.DEV ? DEV_URL : PRODUCTION_URL;
const origin = configured && !(import.meta.env.PROD && pointsAtLocalhost) ? configured : fallback;

export const SITE_URL = origin.replace(/\/+$/, "");

export function siteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
