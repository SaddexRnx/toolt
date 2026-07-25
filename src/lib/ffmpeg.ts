// Lazy singleton loader for ffmpeg.wasm (single-threaded core — no COOP/COEP needed).
//
// The ~30 MB core is fetched from unpkg (immutable version URL) rather than
// bundled. For safety we hash both artifacts with SHA-384 and compare
// against pinned digests: this is fetch()-equivalent to <script integrity>
// and refuses to run tampered code if the CDN is ever compromised.
//
// If you upgrade CORE_VERSION, regenerate the digests:
//   curl -sfL <url> | openssl dgst -sha384 -binary | openssl base64 -A
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { withConcurrency, LIMITS } from "./limits";

const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

// SHA-384 (base64) of the pinned CORE_VERSION artifacts. Computed once from
// the CDN — any drift means the file was replaced and we refuse to load it.
const INTEGRITY = {
  js: "sKfkiFtvUk+vexk+0EUhEh366190/4WpgUAsUvaxEfyg7+E1Zt5Y5hrsU808g8Q9",
  wasm: "U1VDhkPYrM3wTCT4/vjSpSsKqG/UjljYrYCI4hBSJ02svbCkxuCi6U6u/peg5vpW",
} as const;

async function sha384Base64(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-384", bytes);
  let bin = "";
  const view = new Uint8Array(digest);
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return btoa(bin);
}

async function fetchWithIntegrity(url: string, expected: string, mime: string): Promise<string> {
  const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const bytes = await res.arrayBuffer();
  const actual = await sha384Base64(bytes);
  if (actual !== expected) {
    // Refuse to execute anything if the CDN payload doesn't match the pin.
    throw new Error(
      `Refusing to load ${url}: SHA-384 integrity check failed. Expected ${expected}, got ${actual}. This may indicate a compromised CDN.`,
    );
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) return loading;
  loading = (async () => {
    const ff = new FFmpeg();
    const [coreURL, wasmURL] = await Promise.all([
      fetchWithIntegrity(`${CORE_BASE}/ffmpeg-core.js`, INTEGRITY.js, "text/javascript"),
      fetchWithIntegrity(`${CORE_BASE}/ffmpeg-core.wasm`, INTEGRITY.wasm, "application/wasm"),
    ]);
    await ff.load({ coreURL, wasmURL });
    instance = ff;
    return ff;
  })();
  try {
    return await loading;
  } catch (e) {
    loading = null; // allow retry after failure
    throw e;
  }
}

const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
const sanitize = (name: string) => name.replace(/[^\w.\-]+/g, "_");

/**
 * Run ffmpeg with the given args. Wrapped in a concurrency limiter so bulk
 * batches don't run the (single) FFmpeg instance from multiple callers at
 * the same time — that would corrupt its virtual filesystem.
 */
export async function runFFmpeg(
  file: File,
  args: (input: string, output: string) => string[],
  outputExt: string,
  outputMime: string,
): Promise<{ blob: Blob; filename: string }> {
  return withConcurrency(LIMITS.ffmpeg.key, LIMITS.ffmpeg.max, async () => {
    const ff = await getFFmpeg();
    const inputName = sanitize(file.name);
    const outputName = `out.${outputExt.toLowerCase()}`;
    await ff.writeFile(inputName, await fetchFile(file));
    try {
      await ff.exec(args(inputName, outputName));
      const data = (await ff.readFile(outputName)) as Uint8Array;
      const buf = new Uint8Array(data.byteLength);
      buf.set(data);
      return {
        blob: new Blob([buf.buffer as ArrayBuffer], { type: outputMime }),
        filename: `${stripExt(file.name)}.${outputExt.toLowerCase()}`,
      };
    } finally {
      try { await ff.deleteFile(inputName); } catch { /* noop */ }
      try { await ff.deleteFile(outputName); } catch { /* noop */ }
    }
  });
}
