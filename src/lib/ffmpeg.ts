// Lazy singleton loader for ffmpeg.wasm (single-threaded core — no COOP/COEP needed).
// Uses Vite ?url imports so the core JS/WASM ship as static assets.
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core/dist/umd/ffmpeg-core.js?url";
import wasmURL from "@ffmpeg/core/dist/umd/ffmpeg-core.wasm?url";

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) return loading;
  loading = (async () => {
    const ff = new FFmpeg();
    await ff.load({ coreURL, wasmURL });
    instance = ff;
    return ff;
  })();
  return loading;
}

const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
const sanitize = (name: string) => name.replace(/[^\w.\-]+/g, "_");

/**
 * Run ffmpeg with the given args. Input file is written as its sanitized name;
 * outputName is written by ffmpeg and returned as a Blob with the given MIME.
 */
export async function runFFmpeg(
  file: File,
  args: (input: string, output: string) => string[],
  outputExt: string,
  outputMime: string,
): Promise<{ blob: Blob; filename: string }> {
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
}
