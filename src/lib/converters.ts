// All conversions run client-side. Two family shapes:
//   • "per-file": one input file → one output; supports batch queue and an output-format dropdown.
//   • "combine":  multiple input files → one output file (merge/zip).

export type ConvertResult = { blob: Blob; filename: string };

export type OutputOption = {
  ext: string;
  label: string;
  description: string;
  run: (file: File) => Promise<ConvertResult>;
};

type FamilyBase = {
  id: string;
  category: string;
  title: string;
  description: string;
  accept: string;
  inputExts: string[];
};

export type PerFileFamily = FamilyBase & { mode: "per-file"; outputs: OutputOption[] };
export type CombineFamily = FamilyBase & {
  mode: "combine";
  outputExt: string;
  outputLabel: string;
  outputDescription: string;
  run: (files: File[]) => Promise<ConvertResult>;
};

export type Family = PerFileFamily | CombineFamily;

const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
// Single source of truth for reading-time estimates across all tools.
const READING_WPM = 225;
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Remove elements whose text is never page content - scripts, styles, embeds.
const stripNonContentHtml = (html: string) =>
  html.replace(/<(script|style|noscript|template|iframe)[\s\S]*?<\/\1>/gi, "");

function htmlToText(html: string): string {
  const cleaned = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  // A detached textarea decodes entities without executing anything.
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.innerHTML = cleaned;
    return ta.value.replace(/\n{3,}/g, "\n\n");
  }
  return cleaned
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\n{3,}/g, "\n\n");
}

// Cap the O(m*n) LCS matrix (Uint32 cells) at ~160 MB of transient memory.
const DIFF_CELL_LIMIT = 40_000_000;

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
};

async function csvRows(text: string): Promise<Record<string, string>[]> {
  const Papa = (await import("papaparse")).default;
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return res.data ?? [];
}

// Unfold RFC 6350 continuation lines (leading SP/HTAB), then split cards.
function unfoldLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .reduce<string[]>((acc, line) => {
      if (/^[ \t]/.test(line) && acc.length) acc[acc.length - 1] += line.trim();
      else acc.push(line);
      return acc;
    }, [])
    .filter(Boolean);
}

// Pull props out of one textual record (NAME:VALUE list) into a Map of lists.
function recordProps(record: string[]): Map<string, string[]> {
  const props = new Map<string, string[]>();
  for (const line of record) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).split(";")[0].trim().toUpperCase();
    if (!key) continue;
    const arr = props.get(key) ?? [];
    arr.push(line.slice(idx + 1).trim());
    props.set(key, arr);
  }
  return props;
}

type ContactRow = {
  Name: string;
  FullName: string;
  Organization: string;
  Title: string;
  Phone: string;
  Email: string;
};

export function vcardContacts(text: string): ContactRow[] {
  const rows: ContactRow[] = [];
  let current: string[] | null = null;
  const flush = () => {
    if (!current) return;
    const props = recordProps(current);
    const first = (props.get("FN") ?? [])[0] ?? "";
    const nIdx = (props.get("N") ?? [])[0] ?? "";
    const nParts = nIdx.split(/[;,]/).map((p) => p.trim());
    // N order: Family;Given;Middle;Prefix;Suffix -> display order.
    const name =
      first || [nParts[3], nParts[1], nParts[2], nParts[0], nParts[4]].filter(Boolean).join(" ");
    rows.push({
      Name: name || "(unnamed)",
      FullName: first,
      Organization: ((props.get("ORG") ?? [])[0] ?? "").replace(/;/g, " / "),
      Title: (props.get("TITLE") ?? [])[0] ?? "",
      Phone: (props.get("TEL") ?? [])[0] ?? "",
      Email: (props.get("EMAIL") ?? [])[0] ?? "",
    });
    current = null;
  };
  for (const line of unfoldLines(text)) {
    if (/^BEGIN:VCARD$/i.test(line)) {
      flush();
      current = [];
    } else if (/^END:VCARD$/i.test(line)) flush();
    else if (current) current.push(line);
  }
  flush();
  return rows;
}

type EventRow = {
  Summary: string;
  Start: string;
  End: string;
  Location: string;
  Description: string;
};

export function icsEvents(text: string): EventRow[] {
  const rows: EventRow[] = [];
  let current: string[] | null = null;
  const flush = () => {
    if (!current) return;
    const props = recordProps(current);
    rows.push({
      Summary: (props.get("SUMMARY") ?? [])[0] ?? "(no title)",
      Start: (props.get("DTSTART") ?? [])[0] ?? "",
      End: (props.get("DTEND") ?? [])[0] ?? (props.get("DURATION") ?? [])[0] ?? "",
      Location: (props.get("LOCATION") ?? [])[0] ?? "",
      Description: (props.get("DESCRIPTION") ?? [])[0] ?? "",
    });
    current = null;
  };
  for (const line of unfoldLines(text)) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      flush();
      current = [];
    } else if (/^END:VEVENT$/i.test(line)) flush();
    else if (current) current.push(line);
  }
  flush();
  return rows;
}

export function parseLrc(text: string): {
  cues: { start: number; end: number; text: string }[];
  lines: string[];
} {
  const stamp = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  const events: { start: number; text: string }[] = [];
  const lines: string[] = [];
  let lastStart = -1;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const tags: number[] = [];
    stamp.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = stamp.exec(raw))) {
      tags.push(
        Number(m[1]) * 60_000 +
          Number(m[2]) * 1000 +
          Number((m[3] ?? "0").padEnd(3, "0").slice(0, 3)),
      );
    }
    const content = raw.replace(stamp, "").trim();
    if (tags.length === 0) {
      // Metadata tags ([ti:], [ar:], ...) have no timestamp; skip them in TXT.
      if (content && !/^\[[a-zA-Z]+[:"][^\]]*\]$/.test(raw.trim())) lines.push(raw.trim());
      continue;
    }
    if (content) {
      lines.push(content);
      for (const start of tags) {
        events.push({ start, text: content });
        lastStart = Math.max(lastStart, start);
      }
    }
  }
  events.sort((a, b) => a.start - b.start);
  const cues = events.map((e, i) => ({
    start: e.start,
    end: i + 1 < events.length ? events[i + 1].start : lastStart + 5_000,
    text: e.text,
  }));
  return { cues, lines };
}

// ---------------- Subtitle interchange ----------------

type SubCue = { start: number; end: number; text: string };

// Fractional part uses SRT semantics: right-pad to milliseconds. ".5" of a
// second is 500 ms regardless of digit count, so 1-2 digit groups pad right.
const fracToMs = (frac: string) => Number((frac + "000").slice(0, 3));

// h:mm:ss[.,cs] compatible with SRT (,mmm), WebVTT (.mmm) and SSA (.cc 2 digits).
const cueTimeToMs = (raw: string) => {
  const m = raw.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return (h * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + (m[4] ? fracToMs(m[4]) : 0);
};

const msToCueStamp = (t: number, fracSep: string) => {
  const clamped = Math.max(0, Math.round(t));
  const h = String(Math.floor(clamped / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((clamped % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((clamped % 60_000) / 1000)).padStart(2, "0");
  const ms = String(clamped % 1000).padStart(3, "0");
  return `${h}:${m}:${s}${fracSep}${ms}`;
};

// ASS uses centiseconds with a dot: h:mm:ss.cc (03-digit ms clipped to 2).
const msToAssStamp = (t: number) => {
  const s = msToCueStamp(t, ".");
  return `${s.slice(0, -1)}`;
};

// Clock form -> cueTimeToMs; plain "1.5" (s), "0.5s", "500ms" -> ms.
const parseTiming = (raw: string) => {
  if (raw.includes(":")) return cueTimeToMs(raw.trim());
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  if (/ms$/i.test(raw)) return Math.round(n);
  if (/s($|[^a-z])/i.test(raw) || raw.includes(".")) return Math.round(n * 1000);
  return Math.round(n * 1000);
};

const stripAssTags = (text: string) =>
  text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\[Hh]/g, " ")
    .trim();

export function subtitleCues(text: string, ext: string): SubCue[] {
  const clean = text.replace(/^\uFEFF/, "");
  const norm = ext.toUpperCase();
  if (norm === "ASS" || norm === "SSA") {
    let formatFields = [
      "Layer",
      "Start",
      "End",
      "Style",
      "Name",
      "MarginL",
      "MarginR",
      "MarginV",
      "Effect",
      "Text",
    ];
    const cues: SubCue[] = [];
    for (const line of clean.split(/\r?\n/)) {
      const fmt = line.match(/Format:\s*(.+)$/i);
      if (fmt) {
        const fields = fmt[1].split(",").map((x) => x.trim().toLowerCase());
        if (fields.includes("start") && fields.includes("end")) formatFields = fields;
        continue;
      }
      const dlg = line.match(/Dialogue:\s*(.+)$/i);
      if (!dlg) continue;
      const parts = dlg[1].split(",").map((p) => p.trim());
      const sIdx = formatFields.indexOf("start");
      const eIdx = formatFields.indexOf("end");
      const tIdx = formatFields.lastIndexOf("text");
      if (sIdx < 0 || eIdx < 0 || tIdx < 0) continue;
      const start = cueTimeToMs(parts[sIdx]);
      const end = cueTimeToMs(parts[eIdx]);
      if (start == null || end == null) continue;
      const body = stripAssTags(parts.slice(tIdx).join(",").trim());
      if (!body) continue;
      cues.push({ start, end, text: body });
    }
    return cues;
  }
  if (norm === "SMI" || norm === "SAMI") {
    const cues: SubCue[] = [];
    const blockRe = /<sync\s+start\s*=\s*"?(\d+)"?[^>]*>([\s\S]*?)(?=<sync|<\/body|\s*$)/gi;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(clean))) {
      const t = Number(m[1]);
      // Whitespace-only sync blocks are blank markers; every sync closes the
      // still-open previous cue at its own timestamp.
      const body = htmlToText(m[2] ?? "")
        .replace(/&[a-zA-Z#0-9]+;/g, "")
        .trim();
      const last = cues[cues.length - 1];
      if (body) {
        if (last) last.end = t;
        cues.push({ start: t, end: -1, text: body });
      } else if (last && last.end === -1) {
        last.end = t;
      }
    }
    for (const c of cues) if (c.end === -1) c.end = c.start + 3_000;
    return cues;
  }
  if (norm === "TTML" || norm === "DFXP" || norm === "XML") {
    const cues: SubCue[] = [];
    const pRe = /<(?:[\w.-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?p>/gi;
    let m: RegExpExecArray | null;
    const attr = (s: string, name: string) => {
      const a = s.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
      return a ? a[1] : null;
    };
    while ((m = pRe.exec(clean))) {
      const attrs = m[1];
      const startRaw = attr(attrs, "begin") ?? attr(attrs, "start");
      const start = startRaw == null ? null : parseTiming(startRaw);
      const body = htmlToText(m[2]).trim();
      if (start == null || body === "") continue;
      const endRaw = attr(attrs, "end");
      const durRaw = endRaw == null ? (attr(attrs, "dur") ?? attr(attrs, "duration")) : null;
      const end =
        endRaw != null
          ? (parseTiming(endRaw) ?? start + 3_000)
          : durRaw != null && parseTiming(durRaw) != null
            ? start + (parseTiming(durRaw) ?? 3_000)
            : start + 3_000;
      cues.push({ start, end, text: body });
    }
    return cues;
  }
  // SRT / WebVTT block-based formats.
  const stripped = clean.replace(/^WEBVTT.*$/m, "");
  const cues: SubCue[] = [];
  for (const block of stripped.split(/\r?\n\r?\n+/)) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^(?:NOTE|STYLE|REGION)\b/.test(l));
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx === -1) continue;
    const [from, toRaw] = lines[timeIdx].split("-->");
    const start = cueTimeToMs(from.trim());
    const end = cueTimeToMs(toRaw.trim().split(/\s+/)[0]);
    if (start == null || end == null) continue;
    const body = lines
      .slice(timeIdx + 1)
      .join("\n")
      .trim();
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}

export function srtFromCues(cues: SubCue[]) {
  const out = cues
    .map(
      (c, i) =>
        `${i + 1}\r\n${msToCueStamp(c.start, ",")} --> ${msToCueStamp(c.end, ",")}\r\n${c.text}`,
    )
    .join("\r\n\r\n");
  return out + "\r\n";
}

export function vttFromCues(cues: SubCue[]) {
  const out = cues
    .map((c) => `${msToCueStamp(c.start, ".")} --> ${msToCueStamp(c.end, ".")}\r\n${c.text}`)
    .join("\r\n\r\n");
  return `WEBVTT\r\n\r\n${out}\r\n`;
}

export function assFromCues(cues: SubCue[], title: string) {
  const dialogue = cues
    .map(
      (c) =>
        `Dialogue: 0,${msToAssStamp(c.start)},${msToAssStamp(c.end)},Default,,0,0,0,,${c.text.replace(/\r?\n/g, "\\N")}`,
    )
    .join("\n");
  return [
    "[Script Info]",
    `; Converted with To_olT`,
    "Title: " + title,
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,60,60,60,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    dialogue,
    "",
  ].join("\n");
}

// ---------------- Gzip container (SVGZ etc.) ----------------

async function gunzipStream(file: File): Promise<ArrayBuffer> {
  try {
    const stream = new Blob([await file.arrayBuffer()])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
  } catch {
    throw new Error("Not a valid gzip-compressed file.");
  }
}

async function gzipStream(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

// ---------------- FB2 (FictionBook XML) ----------------

function renderFb2Nodes(nodes: unknown[]): string {
  return nodes.map(renderFb2Node).join("");
}

function renderFb2Node(node: unknown): string {
  if (node == null || typeof node !== "object") return escapeHtml(String(node ?? ""));
  const rec = node as Record<string, unknown>;
  const tag = Object.keys(rec).find((k) => k !== ":@");
  if (!tag) return "";
  if (tag === "#text") return escapeHtml(String(rec[tag]));
  const rawValue = rec[tag];
  const inner = Array.isArray(rawValue)
    ? renderFb2Nodes(rawValue)
    : escapeHtml(String(rawValue ?? ""));
  const attrs = (rec[":@"] ?? {}) as Record<string, unknown>;
  switch (tag) {
    case "p":
      return `<p>${inner}</p>`;
    case "title":
      return `<h3>${inner.replace(/<\/?p>/g, "")}</h3>`;
    case "subtitle":
      return `<h4>${inner.replace(/<\/?p>/g, "")}</h4>`;
    case "emphasis":
      return `<em>${inner}</em>`;
    case "strong":
      return `<strong>${inner}</strong>`;
    case "strike":
      return `<s>${inner}</s>`;
    case "sub":
      return `<sub>${inner}</sub>`;
    case "sup":
      return `<sup>${inner}</sup>`;
    case "date":
      return `<time>${inner}</time>`;
    case "poem":
      return `<div class="verse">${inner}</div>`;
    case "stanza":
      return inner;
    case "v":
      return `<p class="verse-line">${inner}</p>`;
    case "epigraph":
    case "cite":
      return `<blockquote>${inner}</blockquote>`;
    case "empty-line":
      return "<br>";
    case "image":
      return "";
    case "table":
      return `<table>${inner}</table>`;
    case "tr":
      return `<tr>${inner}</tr>`;
    case "td":
      return `<td>${inner}</td>`;
    case "th":
      return `<th>${inner}</th>`;
    case "a": {
      const href = attrs["@_href"];
      return href ? `<a href="${escapeHtml(String(href))}">${inner}</a>` : `<span>${inner}</span>`;
    }
    case "style":
      return `<span>${inner}</span>`;
    case "section":
      return `<section>${inner}</section>`;
    case "description":
    case "stylesheet":
    case "binary":
    case "body-name":
      return "";
    default:
      return `<p>${inner}</p>`;
  }
}

export async function fb2ToHtml(text: string): Promise<string> {
  const { XMLParser } = await import("fast-xml-parser");
  const parsed = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    trimValues: false,
  }).parse(text);
  const root = parsed.find((n: Record<string, unknown>) => {
    const tag = Object.keys(n).find((k) => k !== ":@");
    return tag === "FictionBook" || tag === "fb:FictionBook";
  });
  if (!root) throw new Error("No FictionBook root found.");
  const children = root["FictionBook"] ?? root["fb:FictionBook"];
  const nodes = (children ?? []) as Array<Record<string, unknown>>;
  const bodies = nodes.filter((n) => {
    const tag = Object.keys(n).find((k) => k !== ":@");
    return tag === "body" || tag === "fb:body";
  });
  if (bodies.length === 0) throw new Error("No FB2 body content found.");
  return bodies
    .map((b) => {
      const value = b["body"] ?? b["fb:body"];
      return renderFb2Nodes(Array.isArray(value) ? value : []);
    })
    .join("\n");
}

// ---------------- Jupyter notebooks ----------------

type IpynbCell = { cell_type: string; source: string | string[]; outputs?: unknown[] };

const ipynbSource = (src: string | string[] | undefined) =>
  Array.isArray(src) ? src.join("") : (src ?? "");

export function ipynbToParts(text: string): { md: string; py: string } {
  const nb = JSON.parse(text) as { cells?: IpynbCell[]; metadata?: Record<string, unknown> };
  const cells = Array.isArray(nb.cells) ? nb.cells : [];
  const lang = (nb.metadata as { language_info?: Record<string, unknown> } | undefined)
    ?.language_info;
  const langName = typeof lang?.name === "string" ? lang.name : "python";
  const mdChunks: string[] = [];
  const pyChunks: string[] = [];
  for (const cell of cells) {
    const src = ipynbSource(cell.source);
    if (cell.cell_type === "markdown") {
      mdChunks.push(src);
      pyChunks.push(
        src
          .split("\n")
          .map((l) => `# ${l}`)
          .join("\n"),
      );
    } else if (cell.cell_type === "code") {
      const outputs: string[] = [];
      for (const o of Array.isArray(cell.outputs) ? cell.outputs : []) {
        const rec = o as Record<string, unknown>;
        if (typeof rec?.text === "string") outputs.push(rec.text);
        else if (Array.isArray(rec?.text)) outputs.push((rec.text as string[]).join(""));
        if (typeof rec?.data === "object" && rec.data != null) {
          const tp = (rec.data as Record<string, unknown>)["text/plain"];
          if (typeof tp === "string") outputs.push(tp);
          else if (Array.isArray(tp)) outputs.push((tp as string[]).join(""));
        }
      }
      const body = src + (outputs.length ? "\n## Output\n" + outputs.join("").trimEnd() : "");
      mdChunks.push(`\`\`\`${langName}\n${body.trimEnd()}\n\`\`\``);
      pyChunks.push(src);
    }
  }
  return { md: mdChunks.join("\n\n") + "\n", py: pyChunks.join("\n\n") + "\n" };
}

// ---------------- Geo (GPX/KML) ----------------

type GeoPoint = { lat: number; lon: number; ele?: number; time?: string; name?: string };

function collectGpxPoints(node: unknown, out: GeoPoint[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectGpxPoints(item, out);
    return;
  }
  if (typeof node !== "object" || node == null) return;
  const rec = node as Record<string, unknown>;
  const lat = Number(rec["@_lat"]);
  const lon = Number(rec["@_lon"]);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    out.push({
      lat,
      lon,
      ele: Number.isFinite(Number(rec.ele)) ? Number(rec.ele) : undefined,
      time: typeof rec.time === "string" ? rec.time : undefined,
    });
  }
  for (const v of Object.values(rec)) collectGpxPoints(v, out);
}

export async function gpxPoints(text: string): Promise<GeoPoint[]> {
  const { XMLParser } = await import("fast-xml-parser");
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(text);
  const out: GeoPoint[] = [];
  collectGpxPoints(parsed, out);
  return out;
}

export function kmlPoints(text: string): GeoPoint[] {
  const out: GeoPoint[] = [];
  const placemarkRe = /<placemark\b[^>]*>([\s\S]*?)<\/placemark>/gi;
  const nameRe = /<name[^>]*>([\s\S]*?)<\/name>/i;
  let pm: RegExpExecArray | null;
  while ((pm = placemarkRe.exec(text))) {
    const inner = pm[1];
    const name = htmlToText(nameRe.exec(inner)?.[1] ?? "").trim() || undefined;
    const coordRe = /<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
    let cp: RegExpExecArray | null;
    while ((cp = coordRe.exec(inner))) {
      for (const triple of cp[1].split(/\s+/)) {
        const parts = triple.split(",").map(Number);
        if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) continue;
        out.push({ lon: parts[0], lat: parts[1], name });
      }
    }
  }
  return out;
}

// ---------------- EML (plain MIME) ----------------

const decodeQ = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );

function decodeMimeWord(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_full: string, charset: string, enc: string, payload: string) => {
      const chars =
        enc.toLowerCase() === "b"
          ? (() => {
              try {
                return atob(payload.trim());
              } catch {
                return payload;
              }
            })()
          : decodeQ(payload);
      const bytes = Array.from(chars, (c) => c.charCodeAt(0));
      try {
        return new TextDecoder(charset).decode(new Uint8Array(bytes));
      } catch {
        return new TextDecoder().decode(new Uint8Array(bytes));
      }
    },
  );
}

const decodeTransfer = (payload: string, cte: string) => {
  const mode = cte.trim().toLowerCase();
  if (mode === "base64") {
    try {
      const bin = atob(payload.replace(/\s+/g, ""));
      return bin;
    } catch {
      return payload;
    }
  }
  if (mode === "quoted-printable") {
    return payload
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
  return payload;
};

function splitMessage(text: string): { headerText: string; bodyText: string } {
  const match = text.match(/(.*?(?:\r?\n)?\r?\n\r?\n)([\s\S]*)/s);
  if (!match) return { headerText: text.replace(/^\uFEFF/, ""), bodyText: "" };
  return { headerText: match[1].replace(/^\uFEFF/, ""), bodyText: match[2] };
}

const headersOf = (block: string) => {
  const lines = block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  const headers = new Map<string, string>();
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  return headers;
};

export function emlContent(text: string): {
  subject: string;
  from: string;
  to: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
  attachments: { name: string; bytes: Uint8Array }[];
} {
  const { headerText, bodyText: rawBody } = splitMessage(text);
  const top = headersOf(headerText);
  const subject = decodeMimeWord(top.get("subject") ?? "");
  const from = decodeMimeWord(top.get("from") ?? "");
  const to = decodeMimeWord(top.get("to") ?? "");
  const date = top.get("date") ?? "";
  let bodyText = "";
  let bodyHtml = "";
  const attachments: { name: string; bytes: Uint8Array }[] = [];

  const contentType = top.get("content-type") ?? "";
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];

  const handlePart = (part: string) => {
    const h = splitMessage(part);
    if (!h.headerText.includes(":")) return;
    const headers = headersOf(h.headerText);
    const type = headers.get("content-type") ?? "";
    const cte = headers.get("content-transfer-encoding") ?? "";
    const decoded = decodeTransfer(h.bodyText, cte);
    const disposition = headers.get("content-disposition") ?? headers.get("content-type") ?? "";
    const filenameRaw =
      /filename="?([^";\r\n]+)"?/i.exec(disposition)?.[1] ??
      /name="?([^";\r\n]+)"?/i.exec(type)?.[1];
    const isAttachment =
      /attachment|filename=/i.test(disposition) ||
      (filenameRaw != null && !/text\/plain|text\/html/i.test(type));
    if (isAttachment && filenameRaw) {
      const name = decodeMimeWord(filenameRaw.trim());
      const bytes = new Uint8Array(Array.from(decoded, (c) => c.charCodeAt(0)));
      attachments.push({ name, bytes });
      return;
    }
    if (/text\/html/i.test(type) && !bodyHtml) bodyHtml = decoded;
    else if (/text\/plain/i.test(type) && !bodyText) bodyText = decoded;
  };

  if (boundary) {
    for (const part of rawBody.split(`--${boundary}`)) {
      if (!part || part.startsWith("--")) continue;
      const partBoundary = /boundary="?([^";]+)"?/i.exec(part)?.[1];
      if (partBoundary && /multipart/i.test(part)) {
        for (const sub of part.split(`--${partBoundary}`)) {
          if (!sub || sub.startsWith("--")) continue;
          handlePart(sub);
        }
      } else handlePart(part);
    }
  } else if (/text\/html/i.test(contentType))
    bodyHtml = decodeTransfer(rawBody, top.get("content-transfer-encoding") ?? "");
  else bodyText = decodeTransfer(rawBody, top.get("content-transfer-encoding") ?? "");

  return { subject, from, to, date, bodyText, bodyHtml, attachments };
}

async function epubChapters(file: File): Promise<string[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const htmlExts = /\.(xhtml|html|htm)$/i;
  const candidates = Object.keys(zip.files).filter(
    (n) => htmlExts.test(n) && !n.includes("__MACOSX"),
  );
  const parseXml = async () => new (await import("fast-xml-parser")).XMLParser();
  // Spine order, resolved from container.xml -> OPF when present.
  const ordered: string[] = [];
  try {
    const container = await zip.file("META-INF/container.xml")?.async("string");
    if (container) {
      const c = (await parseXml()).parse(container);
      const rootfiles = c?.container?.rootfiles?.rootfile;
      const rf = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
      const opfPath = rf?.["full-path"];
      const opfRaw = opfPath ? await zip.file(opfPath)?.async("string") : undefined;
      if (opfRaw) {
        const opf = (await parseXml()).parse(opfRaw);
        const manifestItem = opf?.package?.manifest?.item;
        const items = Array.isArray(manifestItem)
          ? manifestItem
          : manifestItem
            ? [manifestItem]
            : [];
        const byId = new Map<string, string>(
          items.map((it: Record<string, unknown>) => [String(it.id), String(it.href ?? "")]),
        );
        const spineRef = opf?.package?.spine?.itemref;
        const refs = Array.isArray(spineRef) ? spineRef : spineRef ? [spineRef] : [];
        const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
        const resolve = (href: string) =>
          decodeURIComponent(`${base}${href}`).replace(/^\.\//, "").replace(/^\//, "");
        for (const ref of refs) {
          const href = byId.get(String(ref["idref"] ?? ""));
          if (!href) continue;
          const path = resolve(href);
          const hit = zip.file(path) ? path : findEpubEntry(zip, candidates, path);
          if (hit) ordered.push(hit);
        }
      }
    }
  } catch {
    // fall back to name order below
  }
  const rest = candidates.filter((n) => !ordered.includes(n)).sort();
  const chapters: string[] = [];
  for (const name of [...ordered, ...rest]) {
    const raw = await zip.file(name)!.async("string");
    const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(raw)?.[1];
    if (body && body.trim()) chapters.push(body);
  }
  return chapters;
}

// EPUB hrefs may be case/encoding variants of the actual zip names.
function findEpubEntry(
  zip: { file(name: string): unknown },
  candidates: string[],
  path: string,
): string | null {
  const lower = path.toLowerCase();
  return candidates.find((c) => c.toLowerCase().endsWith(lower)) ?? null;
}

function unifiedDiff(a: string[], b: string[], aName: string, bName: string): string[] {
  const m = a.length;
  const n = b.length;
  if ((m + 1) * (n + 1) > DIFF_CELL_LIMIT)
    throw new Error(
      `Files too large to diff line-by-line (${m.toLocaleString()} vs ${n.toLocaleString()} lines exceed the engine limit).`,
    );
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = n - 1; j >= 0; j--)
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
  }
  const out: string[] = [`--- ${aName}`, `+++ ${bName}`];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`- ${a[i++]}`);
    } else {
      out.push(`+ ${b[j++]}`);
    }
  }
  while (i < m) out.push(`- ${a[i++]}`);
  while (j < n) out.push(`+ ${b[j++]}`);
  return out;
}
const getExt = (name: string) => {
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toUpperCase() : "";
};

export function isAcceptedFile(family: Family, file: File): boolean {
  const ext = getExt(file.name);
  if (family.inputExts.includes(ext) || family.inputExts.includes("ANY")) return true;
  const parts = family.accept.split(",").map((p) => p.trim().toLowerCase());
  return parts.some((p) => {
    if (!p) return false;
    if (p === "*/*") return true;
    if (p.startsWith(".")) return file.name.toLowerCase().endsWith(p);
    if (p.endsWith("/*")) return file.type.startsWith(p.slice(0, -1));
    return file.type === p;
  });
}

// =========================================================================
// Shared helpers
// =========================================================================
async function imageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}
function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error("Encode failed"));
        // Browsers silently fall back to PNG for formats they cannot encode,
        // which would hand the user a file whose bytes contradict its name.
        if (b.type !== mime)
          return reject(new Error(`This browser cannot encode ${mime} (produced ${b.type}).`));
        resolve(b);
      },
      mime,
      quality,
    );
  });
}

// No browser encodes BMP through canvas.toBlob, so write an uncompressed
// 24-bit BITMAPINFOHEADER file by hand instead of shipping PNG bytes named .bmp.
async function canvasToBmp(canvas: HTMLCanvasElement): Promise<Blob> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);
  out[0] = 0x42; // "B"
  out[1] = 0x4d; // "M"
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true); // pixel data offset
  view.setUint32(14, 40, true); // BITMAPINFOHEADER size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive height = bottom-up rows
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true); // 72 DPI
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const alpha = data[i + 3] / 255;
      // BMP has no alpha channel here - composite transparency onto white.
      out[dst++] = Math.round(data[i + 2] * alpha + 255 * (1 - alpha));
      out[dst++] = Math.round(data[i + 1] * alpha + 255 * (1 - alpha));
      out[dst++] = Math.round(data[i] * alpha + 255 * (1 - alpha));
    }
  }
  return new Blob([out], { type: "image/bmp" });
}
function imageOutput(
  ext: string,
  mime: string,
  label: string,
  description: string,
  quality?: number,
): OutputOption {
  return {
    ext,
    label,
    description,
    run: async (file) => {
      const canvas = await imageToCanvas(file);
      const blob = await canvasToBlob(canvas, mime, quality);
      return { blob, filename: `${stripExt(file.name)}.${ext.toLowerCase()}` };
    },
  };
}

async function loadPdfjs() {
  const { loadPdfjs: load } = await import("./pdfjs");
  return load();
}

async function pdfPagesToCanvases(file: File, scale = 2): Promise<HTMLCanvasElement[]> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const doc = await task.promise;
  try {
    const out: HTMLCanvasElement[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport }).promise;
      out.push(canvas);
    }
    return out;
  } finally {
    task.destroy();
  }
}

async function pdfToText(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const chunks: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      chunks.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return chunks.join("\n\n");
  } finally {
    task.destroy();
  }
}

// JWS segments are unpadded base64url, so atob() needs the padding restored.
function bytesFromBase64Url(segment: string): Uint8Array {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Claims are UTF-8 JSON: decode the bytes, not atob()'s latin1 string, or any
// non-ASCII name/email comes out as mojibake (or fails to parse at all).
function decodeJwtPart(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(bytesFromBase64Url(segment)));
}

async function bytesToBase64(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

async function parseData(file: File): Promise<unknown> {
  const text = await file.text();
  const ext = getExt(file.name);
  if (ext === "JSON") return JSON.parse(text);
  if (ext === "YAML" || ext === "YML") return (await import("js-yaml")).load(text);
  if (ext === "XML") return new (await import("fast-xml-parser")).XMLParser().parse(text);
  try {
    return JSON.parse(text);
  } catch {
    return (await import("js-yaml")).load(text);
  }
}

async function hash(
  algo: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512",
  data: ArrayBuffer,
): Promise<string> {
  const h = await crypto.subtle.digest(algo, data);
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =========================================================================
// Registry
// =========================================================================
export const families: Family[] = [
  // ============================================================
  // PDF
  // ============================================================
  {
    id: "pdf-merge",
    category: "PDF",
    title: "Merge PDFs",
    description: "Combine multiple PDF files into one, in the order dropped.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "combine",
    outputExt: "PDF",
    outputLabel: "Merged PDF",
    outputDescription: "All pages concatenated into one file.",
    run: async (files) => {
      const { PDFDocument } = await import("pdf-lib");
      const out = await PDFDocument.create();
      for (const file of files) {
        const src = await PDFDocument.load(await file.arrayBuffer());
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      return {
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        filename: "merged.pdf",
      };
    },
  },
  {
    id: "pdf-split",
    category: "PDF",
    title: "Split PDF",
    description: "Split a PDF into individual pages or a chosen range.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "ZIP",
        label: "One PDF per page (ZIP)",
        description: "Each page becomes its own PDF file inside a ZIP.",
        run: async (file) => {
          const { PDFDocument } = await import("pdf-lib");
          const { default: JSZip } = await import("jszip");
          const src = await PDFDocument.load(await file.arrayBuffer());
          const zip = new JSZip();
          for (let i = 0; i < src.getPageCount(); i++) {
            const doc = await PDFDocument.create();
            const [p] = await doc.copyPages(src, [i]);
            doc.addPage(p);
            zip.file(`page-${i + 1}.pdf`, await doc.save());
          }
          return {
            blob: await zip.generateAsync({ type: "blob" }),
            filename: `${stripExt(file.name)}-pages.zip`,
          };
        },
      },
    ],
  },
  {
    id: "pdf-to-images",
    category: "PDF",
    title: "PDF → Images",
    description: "Render each page of a PDF as a raster image.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "ZIP",
        label: "PNG per page (ZIP)",
        description: "One PNG image for every page, bundled in a ZIP.",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const canvases = await pdfPagesToCanvases(file, 2);
          const zip = new JSZip();
          for (let i = 0; i < canvases.length; i++) {
            const b = await canvasToBlob(canvases[i], "image/png");
            zip.file(`page-${i + 1}.png`, b);
          }
          return {
            blob: await zip.generateAsync({ type: "blob" }),
            filename: `${stripExt(file.name)}-png.zip`,
          };
        },
      },
      {
        ext: "ZIP",
        label: "JPG per page (ZIP)",
        description: "One JPG image for every page (smaller files).",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const canvases = await pdfPagesToCanvases(file, 2);
          const zip = new JSZip();
          for (let i = 0; i < canvases.length; i++) {
            const b = await canvasToBlob(canvases[i], "image/jpeg", 0.9);
            zip.file(`page-${i + 1}.jpg`, b);
          }
          return {
            blob: await zip.generateAsync({ type: "blob" }),
            filename: `${stripExt(file.name)}-jpg.zip`,
          };
        },
      },
      {
        ext: "ZIP",
        label: "WEBP per page (ZIP)",
        description: "One WEBP image for every page (best compression).",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const canvases = await pdfPagesToCanvases(file, 2);
          const zip = new JSZip();
          for (let i = 0; i < canvases.length; i++) {
            const b = await canvasToBlob(canvases[i], "image/webp", 0.9);
            zip.file(`page-${i + 1}.webp`, b);
          }
          return {
            blob: await zip.generateAsync({ type: "blob" }),
            filename: `${stripExt(file.name)}-webp.zip`,
          };
        },
      },
    ],
  },
  {
    id: "images-to-pdf",
    category: "PDF",
    title: "Images → PDF",
    description: "Combine images into one PDF document.",
    accept: "image/jpeg,image/png",
    inputExts: ["JPG", "JPEG", "PNG"],
    mode: "combine",
    outputExt: "PDF",
    outputLabel: "Single PDF",
    outputDescription: "All images stacked as pages in one PDF.",
    run: async (files) => {
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const img = file.type.includes("png")
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes);
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const out = await doc.save();
      return {
        blob: new Blob([out as BlobPart], { type: "application/pdf" }),
        filename: "images.pdf",
      };
    },
  },
  {
    id: "pdf-rotate",
    category: "PDF",
    title: "Rotate PDF",
    description: "Rotate all pages by 90°, 180° or 270°.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      ...[90, 180, 270].map((deg) => ({
        ext: "PDF",
        label: `Rotate ${deg}°`,
        description: `All pages rotated clockwise by ${deg} degrees.`,
        run: async (file: File) => {
          const { PDFDocument, degrees } = await import("pdf-lib");
          const doc = await PDFDocument.load(await file.arrayBuffer());
          doc.getPages().forEach((p) => p.setRotation(degrees(deg)));
          const bytes = await doc.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `rotated-${deg}-${file.name}`,
          };
        },
      })),
    ],
  },
  {
    id: "pdf-reverse",
    category: "PDF",
    title: "Reverse PDF pages",
    description: "Output the same PDF with pages in reverse order.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "Reversed PDF",
        description: "Last page first.",
        run: async (file) => {
          const { PDFDocument } = await import("pdf-lib");
          const src = await PDFDocument.load(await file.arrayBuffer());
          const out = await PDFDocument.create();
          const idx = src.getPageIndices().slice().reverse();
          const pages = await out.copyPages(src, idx);
          pages.forEach((p) => out.addPage(p));
          const bytes = await out.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `reversed-${file.name}`,
          };
        },
      },
    ],
  },
  {
    id: "pdf-nup",
    category: "PDF",
    title: "N-up (multiple per page)",
    description: "Fit 2 or 4 PDF pages onto one page.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      ...([2, 4] as const).map((n) => ({
        ext: "PDF",
        label: `${n} pages per sheet`,
        description: `Combine every ${n} pages into a single landscape sheet.`,
        run: async (file: File) => {
          const { PDFDocument } = await import("pdf-lib");
          const src = await PDFDocument.load(await file.arrayBuffer());
          const out = await PDFDocument.create();
          const embedded = await out.embedPdf(await file.arrayBuffer());
          const first = src.getPage(0);
          const w = first.getWidth();
          const h = first.getHeight();
          const cols = 2;
          const rows = n === 2 ? 1 : 2;
          const sheetW = w * cols;
          const sheetH = h * rows;
          for (let i = 0; i < embedded.length; i += n) {
            const page = out.addPage([sheetW, sheetH]);
            for (let j = 0; j < n && i + j < embedded.length; j++) {
              const col = j % cols;
              const row = Math.floor(j / cols);
              page.drawPage(embedded[i + j], {
                x: col * w,
                y: sheetH - (row + 1) * h,
                width: w,
                height: h,
              });
            }
          }
          const bytes = await out.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `${n}up-${file.name}`,
          };
        },
      })),
    ],
  },
  {
    id: "pdf-page-numbers",
    category: "PDF",
    title: "Add page numbers",
    description: "Stamp page numbers at the bottom of every page.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "Numbered PDF",
        description: "Adds '1 / N' at the bottom-center of each page.",
        run: async (file) => {
          const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
          const doc = await PDFDocument.load(await file.arrayBuffer());
          const font = await doc.embedFont(StandardFonts.Helvetica);
          const pages = doc.getPages();
          pages.forEach((p, i) => {
            const text = `${i + 1} / ${pages.length}`;
            const size = 10;
            const w = font.widthOfTextAtSize(text, size);
            p.drawText(text, {
              x: p.getWidth() / 2 - w / 2,
              y: 20,
              size,
              font,
              color: rgb(0.3, 0.3, 0.3),
            });
          });
          const bytes = await doc.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `numbered-${file.name}`,
          };
        },
      },
    ],
  },
  {
    id: "pdf-watermark",
    category: "PDF",
    title: "Watermark PDF",
    description: "Stamp a diagonal 'CONFIDENTIAL' or 'DRAFT' watermark on every page.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      ...["CONFIDENTIAL", "DRAFT", "SAMPLE", "COPY"].map((text) => ({
        ext: "PDF",
        label: `Watermark: ${text}`,
        description: `Adds a light diagonal '${text}' watermark across every page.`,
        run: async (file: File) => {
          const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
          const doc = await PDFDocument.load(await file.arrayBuffer());
          const font = await doc.embedFont(StandardFonts.HelveticaBold);
          doc.getPages().forEach((p) => {
            const w = p.getWidth();
            const h = p.getHeight();
            p.drawText(text, {
              x: w / 2 - 200,
              y: h / 2,
              size: 80,
              font,
              color: rgb(0.85, 0.85, 0.85),
              opacity: 0.35,
              rotate: degrees(-30),
            });
          });
          const bytes = await doc.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `watermarked-${file.name}`,
          };
        },
      })),
    ],
  },
  {
    id: "pdf-blank-inserter",
    category: "PDF",
    title: "Insert blank pages",
    description: "Insert a blank A4 page after every page (useful for printing).",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "Interleaved with blanks",
        description: "Adds a blank page after each existing page.",
        run: async (file) => {
          const { PDFDocument } = await import("pdf-lib");
          const src = await PDFDocument.load(await file.arrayBuffer());
          const out = await PDFDocument.create();
          for (let i = 0; i < src.getPageCount(); i++) {
            const [p] = await out.copyPages(src, [i]);
            out.addPage(p);
            const orig = src.getPage(i);
            out.addPage([orig.getWidth(), orig.getHeight()]);
          }
          const bytes = await out.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `interleaved-${file.name}`,
          };
        },
      },
    ],
  },
  {
    id: "pdf-to-text",
    category: "PDF",
    title: "PDF → Text",
    description: "Extract plain text, Markdown or HTML from a PDF's text layer.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Plain text (.txt)",
        description: "Just the text content, page by page.",
        run: async (file) => {
          const text = await pdfToText(file);
          return {
            blob: new Blob([text], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
      {
        ext: "MD",
        label: "Markdown (.md)",
        description: "Text wrapped with a page heading for each page.",
        run: async (file) => {
          const pdfjs = await loadPdfjs();
          const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
          const doc = await task.promise;
          try {
            const parts: string[] = [];
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i);
              const tc = await page.getTextContent();
              parts.push(
                `## Page ${i}\n\n${tc.items.map((it) => ("str" in it ? it.str : "")).join(" ")}`,
              );
            }
            return {
              blob: new Blob([parts.join("\n\n")], { type: "text/markdown" }),
              filename: `${stripExt(file.name)}.md`,
            };
          } finally {
            task.destroy();
          }
        },
      },
      {
        ext: "HTML",
        label: "HTML (.html)",
        description: "Simple HTML with one paragraph per page.",
        run: async (file) => {
          const text = await pdfToText(file);
          const body = text
            .split("\n\n")
            .map((p) => `<p>${escapeHtml(p)}</p>`)
            .join("\n");
          const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(stripExt(file.name))}</title>${body}`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
      {
        ext: "JSON",
        label: "JSON (per-page)",
        description: "Array of { page, text } objects.",
        run: async (file) => {
          const pdfjs = await loadPdfjs();
          const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
          const doc = await task.promise;
          try {
            const arr: { page: number; text: string }[] = [];
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i);
              const tc = await page.getTextContent();
              arr.push({
                page: i,
                text: tc.items.map((it) => ("str" in it ? it.str : "")).join(" "),
              });
            }
            return {
              blob: new Blob([JSON.stringify(arr, null, 2)], { type: "application/json" }),
              filename: `${stripExt(file.name)}.json`,
            };
          } finally {
            task.destroy();
          }
        },
      },
    ],
  },
  {
    id: "pdf-to-word",
    category: "PDF",
    title: "PDF → Word",
    description:
      "Convert a PDF's text layer into an editable Word (.docx) or Rich Text (.rtf) document - one paragraph per PDF page.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "DOCX",
        label: "Word document (.docx)",
        description: "Editable .docx with a heading per page and paragraphs of extracted text.",
        run: async (file) => {
          const pdfjs = await loadPdfjs();
          const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
          const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
          const doc = await task.promise;
          try {
            const children: InstanceType<typeof Paragraph>[] = [];
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i);
              const tc = await page.getTextContent();
              const lines: string[] = [];
              let current = "";
              let lastY: number | null = null;
              for (const it of tc.items) {
                if (!("str" in it)) continue;
                const y = Array.isArray((it as { transform?: number[] }).transform)
                  ? (it as { transform: number[] }).transform[5]
                  : null;
                if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
                  if (current.trim()) lines.push(current.trim());
                  current = "";
                }
                current += (current ? " " : "") + it.str;
                lastY = y;
              }
              if (current.trim()) lines.push(current.trim());
              children.push(
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  children: [new TextRun(`Page ${i}`)],
                }),
              );
              for (const line of lines) {
                children.push(new Paragraph({ children: [new TextRun(line)] }));
              }
              children.push(new Paragraph({ children: [new TextRun("")] }));
            }
            const docx = new Document({ sections: [{ children }] });
            const blob = await Packer.toBlob(docx);
            return { blob, filename: `${stripExt(file.name)}.docx` };
          } finally {
            task.destroy();
          }
        },
      },
      {
        ext: "RTF",
        label: "Rich Text (.rtf)",
        description: "Universally editable Rich Text - opens in Word, Pages and LibreOffice.",
        run: async (file) => {
          const pdfjs = await loadPdfjs();
          const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
          const doc = await task.promise;
          try {
            const esc = (s: string) =>
              s
                .replace(/\\/g, "\\\\")
                .replace(/[{}]/g, (c) => `\\${c}`)
                .replace(/[\u0080-\uFFFF]/g, (c) => {
                  const code = c.charCodeAt(0);
                  // RTF \uN takes a SIGNED 16-bit value (2's complement).
                  return `\\u${code > 32767 ? code - 65536 : code}?`;
                });
            const parts: string[] = [`{\\rtf1\\ansi\\deff0`];
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i);
              const tc = await page.getTextContent();
              const text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
              parts.push(`\\b Page ${i}\\b0\\par ${esc(text)}\\par\\par`);
            }
            parts.push(`}`);
            return {
              blob: new Blob([parts.join("\n")], { type: "application/rtf" }),
              filename: `${stripExt(file.name)}.rtf`,
            };
          } finally {
            task.destroy();
          }
        },
      },
    ],
  },
  {
    id: "pdf-metadata-strip",
    category: "PDF",
    title: "Strip PDF metadata",
    description: "Remove title, author, subject and keywords from a PDF.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "Metadata-free PDF",
        description: "Blanks title/author/subject/keywords/creator/producer.",
        run: async (file) => {
          const { PDFDocument } = await import("pdf-lib");
          const doc = await PDFDocument.load(await file.arrayBuffer());
          doc.setTitle("");
          doc.setAuthor("");
          doc.setSubject("");
          doc.setKeywords([]);
          doc.setCreator("");
          doc.setProducer("");
          const bytes = await doc.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `stripped-${file.name}`,
          };
        },
      },
    ],
  },
  {
    id: "pdf-grayscale",
    category: "PDF",
    title: "Grayscale PDF",
    description: "Render each page to a grayscale image and rebuild the PDF.",
    accept: "application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "Grayscale PDF",
        description: "Ideal for printing / ink saving.",
        run: async (file) => {
          const { PDFDocument } = await import("pdf-lib");
          const canvases = await pdfPagesToCanvases(file, 2);
          const doc = await PDFDocument.create();
          for (const c of canvases) {
            const ctx = c.getContext("2d")!;
            const img = ctx.getImageData(0, 0, c.width, c.height);
            for (let i = 0; i < img.data.length; i += 4) {
              const g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
              img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
            }
            ctx.putImageData(img, 0, 0);
            const jpg = await canvasToBlob(c, "image/jpeg", 0.9);
            const emb = await doc.embedJpg(await jpg.arrayBuffer());
            const page = doc.addPage([c.width, c.height]);
            page.drawImage(emb, { x: 0, y: 0, width: c.width, height: c.height });
          }
          const bytes = await doc.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `gray-${file.name}`,
          };
        },
      },
    ],
  },

  // ============================================================
  // IMAGES
  // ============================================================
  {
    id: "image-convert",
    category: "Images",
    title: "Convert image",
    description: "Convert between JPG, PNG, WEBP and BMP.",
    accept: "image/*",
    // TIFF is deliberately absent: browsers cannot decode it through
    // createImageBitmap, so every TIFF drop failed with an opaque error.
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "GIF", "BMP", "AVIF"],
    mode: "per-file",
    outputs: [
      imageOutput("PNG", "image/png", "PNG (lossless)", "Lossless raster with alpha."),
      imageOutput("JPG", "image/jpeg", "JPG (photo)", "Smaller, no transparency.", 0.92),
      imageOutput("WEBP", "image/webp", "WEBP (modern)", "Best compression / quality ratio.", 0.9),
      {
        ext: "BMP",
        label: "BMP",
        description: "Uncompressed 24-bit bitmap, encoded locally.",
        run: async (file) => {
          const canvas = await imageToCanvas(file);
          return {
            blob: await canvasToBmp(canvas),
            filename: `${stripExt(file.name)}.bmp`,
          };
        },
      },
    ],
  },
  {
    id: "image-compress",
    category: "Images",
    title: "Compress image",
    description: "Reduce image file size while keeping quality.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP"],
    mode: "per-file",
    outputs: [
      {
        ext: "AUTO",
        label: "Same format - smaller",
        description: "Keep the input format, target under ~1 MB.",
        run: async (file) => {
          const { default: compress } = await import("browser-image-compression");
          const out = await compress(file, {
            maxSizeMB: 1,
            maxWidthOrHeight: 2400,
            useWebWorker: true,
          });
          return { blob: out, filename: `compressed-${file.name}` };
        },
      },
      {
        ext: "WEBP",
        label: "Convert to WEBP (smallest)",
        description: "Re-encode as WEBP for maximum compression.",
        run: async (file) => {
          const { default: compress } = await import("browser-image-compression");
          const out = await compress(file, {
            maxSizeMB: 1,
            maxWidthOrHeight: 2400,
            useWebWorker: true,
            fileType: "image/webp",
          });
          return { blob: out, filename: `${stripExt(file.name)}.webp` };
        },
      },
    ],
  },
  {
    id: "image-resize",
    category: "Images",
    title: "Resize image",
    description: "Resize to a fixed max dimension while keeping the aspect ratio.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "GIF", "BMP"],
    mode: "per-file",
    outputs: [
      ...[3840, 1920, 1280, 800, 400].map((max) => ({
        ext: "PNG",
        label: `Max ${max}px (longest side)`,
        description: `Downscales so the longest side is ${max}px.`,
        run: async (file: File) => {
          const bitmap = await createImageBitmap(file);
          try {
            const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
            const w = Math.round(bitmap.width * scale);
            const h = Math.round(bitmap.height * scale);
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            c.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
            const blob = await canvasToBlob(c, "image/png");
            return { blob, filename: `${stripExt(file.name)}-${max}.png` };
          } finally {
            bitmap.close();
          }
        },
      })),
    ],
  },
  {
    id: "image-rotate",
    category: "Images",
    title: "Rotate image",
    description: "Rotate an image by 90°, 180° or 270°.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      ...[90, 180, 270].map((deg) => ({
        ext: "PNG",
        label: `Rotate ${deg}°`,
        description: `Rotate clockwise by ${deg} degrees.`,
        run: async (file: File) => {
          const bitmap = await createImageBitmap(file);
          try {
            const rad = (deg * Math.PI) / 180;
            const c = document.createElement("canvas");
            if (deg === 180) {
              c.width = bitmap.width;
              c.height = bitmap.height;
            } else {
              c.width = bitmap.height;
              c.height = bitmap.width;
            }
            const ctx = c.getContext("2d")!;
            ctx.translate(c.width / 2, c.height / 2);
            ctx.rotate(rad);
            ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
            const blob = await canvasToBlob(c, "image/png");
            return { blob, filename: `rotated-${deg}-${stripExt(file.name)}.png` };
          } finally {
            bitmap.close();
          }
        },
      })),
    ],
  },
  {
    id: "image-flip",
    category: "Images",
    title: "Flip image",
    description: "Mirror an image horizontally or vertically.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      ...(["horizontal", "vertical"] as const).map((dir) => ({
        ext: "PNG",
        label: `Flip ${dir}`,
        description: `Mirror the image ${dir}ly.`,
        run: async (file: File) => {
          const bitmap = await createImageBitmap(file);
          try {
            const c = document.createElement("canvas");
            c.width = bitmap.width;
            c.height = bitmap.height;
            const ctx = c.getContext("2d")!;
            if (dir === "horizontal") {
              ctx.translate(c.width, 0);
              ctx.scale(-1, 1);
            } else {
              ctx.translate(0, c.height);
              ctx.scale(1, -1);
            }
            ctx.drawImage(bitmap, 0, 0);
            const blob = await canvasToBlob(c, "image/png");
            return { blob, filename: `flip-${dir}-${stripExt(file.name)}.png` };
          } finally {
            bitmap.close();
          }
        },
      })),
    ],
  },
  {
    id: "image-grayscale",
    category: "Images",
    title: "Grayscale image",
    description: "Convert to black-and-white grayscale.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "Grayscale (.png)",
        description: "Full-tone grayscale, retains alpha.",
        run: async (file) => {
          const c = await imageToCanvas(file);
          const ctx = c.getContext("2d")!;
          const img = ctx.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < img.data.length; i += 4) {
            const g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
            img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
          }
          ctx.putImageData(img, 0, 0);
          return {
            blob: await canvasToBlob(c, "image/png"),
            filename: `gray-${stripExt(file.name)}.png`,
          };
        },
      },
    ],
  },
  {
    id: "image-invert",
    category: "Images",
    title: "Invert colors",
    description: "Invert every pixel - like a photo negative.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "Inverted (.png)",
        description: "Applies photographic negative to RGB channels.",
        run: async (file) => {
          const c = await imageToCanvas(file);
          const ctx = c.getContext("2d")!;
          const img = ctx.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < img.data.length; i += 4) {
            img.data[i] = 255 - img.data[i];
            img.data[i + 1] = 255 - img.data[i + 1];
            img.data[i + 2] = 255 - img.data[i + 2];
          }
          ctx.putImageData(img, 0, 0);
          return {
            blob: await canvasToBlob(c, "image/png"),
            filename: `invert-${stripExt(file.name)}.png`,
          };
        },
      },
    ],
  },
  {
    id: "image-blur",
    category: "Images",
    title: "Blur image",
    description: "Apply a Gaussian-style blur.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      ...[4, 12, 24].map((r) => ({
        ext: "PNG",
        label: `Blur ${r}px`,
        description: `Soft blur with a ${r}px radius.`,
        run: async (file: File) => {
          const bitmap = await createImageBitmap(file);
          try {
            const c = document.createElement("canvas");
            c.width = bitmap.width;
            c.height = bitmap.height;
            const ctx = c.getContext("2d")!;
            ctx.filter = `blur(${r}px)`;
            ctx.drawImage(bitmap, 0, 0);
            const blob = await canvasToBlob(c, "image/png");
            return { blob, filename: `blur-${r}-${stripExt(file.name)}.png` };
          } finally {
            bitmap.close();
          }
        },
      })),
    ],
  },
  {
    id: "image-crop-square",
    category: "Images",
    title: "Center-crop to square",
    description: "Crop an image to a centered square - great for avatars.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "Square crop (.png)",
        description: "Crops the largest possible centered square.",
        run: async (file) => {
          const bitmap = await createImageBitmap(file);
          try {
            const side = Math.min(bitmap.width, bitmap.height);
            const x = (bitmap.width - side) / 2;
            const y = (bitmap.height - side) / 2;
            const c = document.createElement("canvas");
            c.width = side;
            c.height = side;
            c.getContext("2d")!.drawImage(bitmap, x, y, side, side, 0, 0, side, side);
            return {
              blob: await canvasToBlob(c, "image/png"),
              filename: `square-${stripExt(file.name)}.png`,
            };
          } finally {
            bitmap.close();
          }
        },
      },
    ],
  },
  {
    id: "image-circle-crop",
    category: "Images",
    title: "Circle crop (avatar)",
    description: "Crop to a circle with transparent background.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "Circular PNG",
        description: "Perfect for profile pictures.",
        run: async (file) => {
          const bitmap = await createImageBitmap(file);
          try {
            const side = Math.min(bitmap.width, bitmap.height);
            const x = (bitmap.width - side) / 2;
            const y = (bitmap.height - side) / 2;
            const c = document.createElement("canvas");
            c.width = side;
            c.height = side;
            const ctx = c.getContext("2d")!;
            ctx.beginPath();
            ctx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(bitmap, x, y, side, side, 0, 0, side, side);
            return {
              blob: await canvasToBlob(c, "image/png"),
              filename: `circle-${stripExt(file.name)}.png`,
            };
          } finally {
            bitmap.close();
          }
        },
      },
    ],
  },
  {
    id: "image-watermark",
    category: "Images",
    title: "Watermark image",
    description: "Stamp text across the image (bottom-right).",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      ...["© Confidential", "DRAFT", "SAMPLE"].map((text) => ({
        ext: "PNG",
        label: `Watermark: "${text}"`,
        description: `Adds a "${text}" label in the bottom-right corner.`,
        run: async (file: File) => {
          const c = await imageToCanvas(file);
          const ctx = c.getContext("2d")!;
          const size = Math.max(16, Math.round(c.width / 30));
          ctx.font = `bold ${size}px sans-serif`;
          ctx.textBaseline = "bottom";
          ctx.textAlign = "right";
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.lineWidth = Math.max(2, size / 8);
          ctx.strokeText(text, c.width - 20, c.height - 20);
          ctx.fillText(text, c.width - 20, c.height - 20);
          const blob = await canvasToBlob(c, "image/png");
          return { blob, filename: `wm-${stripExt(file.name)}.png` };
        },
      })),
    ],
  },
  {
    id: "image-to-favicon",
    category: "Images",
    title: "Image → Favicon set",
    description: "Generate 16, 32, 48, 64, 180, 192 & 512 px PNG icons.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      {
        ext: "ZIP",
        label: "Favicon pack (ZIP)",
        description: "All common favicon sizes, PNG.",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const bitmap = await createImageBitmap(file);
          try {
            const zip = new JSZip();
            for (const size of [16, 32, 48, 64, 180, 192, 512]) {
              const c = document.createElement("canvas");
              c.width = size;
              c.height = size;
              c.getContext("2d")!.drawImage(bitmap, 0, 0, size, size);
              zip.file(`favicon-${size}.png`, await canvasToBlob(c, "image/png"));
            }
            return { blob: await zip.generateAsync({ type: "blob" }), filename: `favicons.zip` };
          } finally {
            bitmap.close();
          }
        },
      },
    ],
  },
  {
    id: "image-strip-exif",
    category: "Images",
    title: "Strip EXIF / metadata",
    description: "Re-encode an image to drop EXIF data, GPS location, etc.",
    accept: "image/jpeg,image/png,image/webp",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP"],
    mode: "per-file",
    outputs: [
      {
        ext: "JPG",
        label: "Clean JPG",
        description: "Re-encoded as JPG without any metadata.",
        run: async (file) => {
          const c = await imageToCanvas(file);
          return {
            blob: await canvasToBlob(c, "image/jpeg", 0.95),
            filename: `clean-${stripExt(file.name)}.jpg`,
          };
        },
      },
    ],
  },
  {
    id: "image-to-base64",
    category: "Images",
    title: "Image → Base64 / Data URL",
    description: "Get a base64 string or a data: URL for the image.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "GIF", "SVG", "BMP"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Base64",
        description: "Raw base64 bytes (no data: prefix).",
        run: async (file) => {
          const b64 = await bytesToBase64(await file.arrayBuffer());
          return {
            blob: new Blob([b64], { type: "text/plain" }),
            filename: `${file.name}.b64.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Data URL",
        description: "Copy-paste ready `data:image/…;base64,…` string.",
        run: async (file) => {
          const b64 = await bytesToBase64(await file.arrayBuffer());
          const url = `data:${file.type || "image/png"};base64,${b64}`;
          return {
            blob: new Blob([url], { type: "text/plain" }),
            filename: `${file.name}.dataurl.txt`,
          };
        },
      },
    ],
  },
  {
    id: "svg-to-png",
    category: "Images",
    title: "SVG → PNG",
    description: "Rasterize an SVG at 1×, 2× and 4× scale.",
    accept: ".svg,image/svg+xml",
    inputExts: ["SVG"],
    mode: "per-file",
    outputs: [
      ...[1, 2, 4].map((scale) => ({
        ext: "PNG",
        label: `${scale}× PNG`,
        description: `Renders the SVG at ${scale}× its natural size.`,
        run: async (file: File) => {
          const text = await file.text();
          const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
          try {
            const img = new Image();
            await new Promise<void>((res, rej) => {
              img.onload = () => res();
              img.onerror = () => rej(new Error("SVG load failed"));
              img.src = url;
            });
            const w = (img.naturalWidth || 512) * scale;
            const h = (img.naturalHeight || 512) * scale;
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            c.getContext("2d")!.drawImage(img, 0, 0, w, h);
            const blob = await canvasToBlob(c, "image/png");
            return { blob, filename: `${stripExt(file.name)}@${scale}x.png` };
          } finally {
            URL.revokeObjectURL(url);
          }
        },
      })),
    ],
  },
  {
    id: "image-to-pdf-single",
    category: "Images",
    title: "Image → single-page PDF",
    description: "Wrap one image into a PDF (one file per drop).",
    accept: "image/jpeg,image/png",
    inputExts: ["JPG", "JPEG", "PNG"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "Single-image PDF",
        description: "PDF sized to the image dimensions.",
        run: async (file) => {
          const { PDFDocument } = await import("pdf-lib");
          const doc = await PDFDocument.create();
          const bytes = new Uint8Array(await file.arrayBuffer());
          const img = file.type.includes("png")
            ? await doc.embedPng(bytes)
            : await doc.embedJpg(bytes);
          const page = doc.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          const out = await doc.save();
          return {
            blob: new Blob([out as BlobPart], { type: "application/pdf" }),
            filename: `${stripExt(file.name)}.pdf`,
          };
        },
      },
    ],
  },
  {
    id: "base64-to-image",
    category: "Images",
    title: "Base64 / Data URL → Image",
    description: "Decode a base64 or data URL text file back to an image.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "Decoded image",
        description: "Reads base64 or a data: URL from the file and saves the bytes.",
        run: async (file) => {
          let text = (await file.text()).trim();
          let mime = "image/png";
          if (text.startsWith("data:")) {
            const m = text.match(/^data:([^;]+);base64,(.*)$/s);
            if (!m) throw new Error("Malformed data URL");
            mime = m[1];
            text = m[2];
          }
          const bin = atob(text.replace(/\s+/g, ""));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const extGuess = mime.split("/")[1] || "png";
          return {
            blob: new Blob([bytes], { type: mime }),
            filename: `${stripExt(file.name)}.${extGuess}`,
          };
        },
      },
    ],
  },

  // ============================================================
  // SPREADSHEETS
  // ============================================================
  {
    id: "spreadsheet",
    category: "Spreadsheets",
    title: "Convert spreadsheet",
    description: "Convert between CSV, TSV, XLSX, XLS, ODS, JSON and HTML.",
    accept:
      ".csv,.tsv,.xlsx,.xls,.ods,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet",
    inputExts: ["CSV", "TSV", "XLSX", "XLS", "ODS"],
    mode: "per-file",
    outputs: [
      {
        ext: "XLSX",
        label: "Excel (.xlsx)",
        description: "Modern Excel spreadsheet.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
          return {
            blob: new Blob([out], {
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }),
            filename: `${stripExt(file.name)}.xlsx`,
          };
        },
      },
      {
        ext: "ODS",
        label: "OpenDocument (.ods)",
        description: "LibreOffice / OpenDocument spreadsheet.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const out = XLSX.write(wb, { bookType: "ods", type: "array" });
          return {
            blob: new Blob([out], { type: "application/vnd.oasis.opendocument.spreadsheet" }),
            filename: `${stripExt(file.name)}.ods`,
          };
        },
      },
      {
        ext: "CSV",
        label: "CSV (comma-separated)",
        description: "First sheet as CSV.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          return {
            blob: new Blob([csv], { type: "text/csv" }),
            filename: `${stripExt(file.name)}.csv`,
          };
        },
      },
      {
        ext: "TSV",
        label: "TSV (tab-separated)",
        description: "First sheet as tab-separated values.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const tsv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: "\t" });
          return {
            blob: new Blob([tsv], { type: "text/tab-separated-values" }),
            filename: `${stripExt(file.name)}.tsv`,
          };
        },
      },
      {
        ext: "JSON",
        label: "JSON (array of rows)",
        description: "First sheet as an array of row objects.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          return {
            blob: new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
      {
        ext: "HTML",
        label: "HTML table",
        description: "First sheet as an HTML table.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const html = XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]);
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
    ],
  },
  {
    id: "spreadsheet-sheets-to-zip",
    category: "Spreadsheets",
    title: "Split workbook (each sheet → CSV)",
    description: "Explode every sheet of an Excel file into its own CSV.",
    accept: ".xlsx,.xls,.ods",
    inputExts: ["XLSX", "XLS", "ODS"],
    mode: "per-file",
    outputs: [
      {
        ext: "ZIP",
        label: "One CSV per sheet (ZIP)",
        description: "Bundles every worksheet as a separate CSV.",
        run: async (file) => {
          const XLSX = await import("xlsx");
          const { default: JSZip } = await import("jszip");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const zip = new JSZip();
          wb.SheetNames.forEach((n) => {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]);
            zip.file(`${n}.csv`, csv);
          });
          return {
            blob: await zip.generateAsync({ type: "blob" }),
            filename: `${stripExt(file.name)}-sheets.zip`,
          };
        },
      },
    ],
  },

  // ============================================================
  // DATA
  // ============================================================
  {
    id: "data",
    category: "Data",
    title: "Convert data file",
    description: "Convert between JSON, YAML, XML and CSV.",
    accept: ".json,.yaml,.yml,.xml,application/json,application/xml,text/xml,text/yaml",
    inputExts: ["JSON", "YAML", "YML", "XML"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "JSON (2-space)",
        description: "Standard JSON with 2-space indent.",
        run: async (file) => {
          const data = await parseData(file);
          return {
            blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
      {
        ext: "YAML",
        label: "YAML",
        description: "Human-readable YAML.",
        run: async (file) => {
          const yaml = await import("js-yaml");
          const data = await parseData(file);
          return {
            blob: new Blob([yaml.dump(data)], { type: "text/yaml" }),
            filename: `${stripExt(file.name)}.yaml`,
          };
        },
      },
      {
        ext: "XML",
        label: "XML",
        description: "XML built from the parsed structure.",
        run: async (file) => {
          const { XMLBuilder } = await import("fast-xml-parser");
          const data = await parseData(file);
          const xml = new XMLBuilder({ format: true }).build(data);
          return {
            blob: new Blob([xml], { type: "application/xml" }),
            filename: `${stripExt(file.name)}.xml`,
          };
        },
      },
      {
        ext: "CSV",
        label: "CSV (array of objects)",
        description: "Flatten a JSON/YAML array of objects into CSV.",
        run: async (file) => {
          const Papa = (await import("papaparse")).default;
          const data = await parseData(file);
          if (!Array.isArray(data))
            throw new Error("CSV export needs an array of objects at the root.");
          return {
            blob: new Blob([Papa.unparse(data)], { type: "text/csv" }),
            filename: `${stripExt(file.name)}.csv`,
          };
        },
      },
    ],
  },
  {
    id: "json-format",
    category: "Data",
    title: "Format / minify JSON",
    description: "Pretty-print or minify JSON files.",
    accept: ".json,application/json",
    inputExts: ["JSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Prettify (2-space)",
        description: "Re-indent with 2-space padding.",
        run: async (file) => {
          const d = JSON.parse(await file.text());
          return {
            blob: new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
            filename: `pretty-${file.name}`,
          };
        },
      },
      {
        ext: "JSON",
        label: "Prettify (4-space)",
        description: "Re-indent with 4-space padding.",
        run: async (file) => {
          const d = JSON.parse(await file.text());
          return {
            blob: new Blob([JSON.stringify(d, null, 4)], { type: "application/json" }),
            filename: `pretty4-${file.name}`,
          };
        },
      },
      {
        ext: "JSON",
        label: "Minify",
        description: "Strip all whitespace.",
        run: async (file) => {
          const d = JSON.parse(await file.text());
          return {
            blob: new Blob([JSON.stringify(d)], { type: "application/json" }),
            filename: `min-${file.name}`,
          };
        },
      },
    ],
  },
  {
    id: "csv-tools",
    category: "Data",
    title: "CSV utilities",
    description: "Deduplicate rows or split a large CSV into chunks.",
    accept: ".csv,text/csv",
    inputExts: ["CSV"],
    mode: "per-file",
    outputs: [
      {
        ext: "CSV",
        label: "Deduplicate rows",
        description: "Removes exact duplicate rows (header preserved).",
        run: async (file) => {
          const Papa = (await import("papaparse")).default;
          const parsed = Papa.parse<string[]>(await file.text());
          const rows = parsed.data.filter((r) => r.length > 0);
          if (rows.length === 0) throw new Error("Empty CSV");
          const [head, ...rest] = rows;
          const seen = new Set<string>();
          const out = [
            head,
            ...rest.filter((r) => {
              const k = r.join("\u0001");
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            }),
          ];
          return {
            blob: new Blob([Papa.unparse(out)], { type: "text/csv" }),
            filename: `dedup-${file.name}`,
          };
        },
      },
      {
        ext: "ZIP",
        label: "Split into 1 000-row chunks",
        description: "Break the CSV into files of 1 000 rows plus header, bundled as ZIP.",
        run: async (file) => {
          const Papa = (await import("papaparse")).default;
          const { default: JSZip } = await import("jszip");
          const parsed = Papa.parse<string[]>(await file.text());
          const rows = parsed.data.filter((r) => r.length > 0);
          if (rows.length === 0) throw new Error("Empty CSV");
          const [head, ...body] = rows;
          const size = 1000;
          const zip = new JSZip();
          for (let i = 0; i < body.length; i += size) {
            const chunk = [head, ...body.slice(i, i + size)];
            zip.file(
              `${stripExt(file.name)}-part${Math.floor(i / size) + 1}.csv`,
              Papa.unparse(chunk),
            );
          }
          return {
            blob: await zip.generateAsync({ type: "blob" }),
            filename: `${stripExt(file.name)}-chunks.zip`,
          };
        },
      },
    ],
  },
  {
    id: "csv-merge",
    category: "Data",
    title: "Merge CSVs",
    description: "Concatenate multiple CSVs (keeps the first header only).",
    accept: ".csv,text/csv",
    inputExts: ["CSV"],
    mode: "combine",
    outputExt: "CSV",
    outputLabel: "Merged CSV",
    outputDescription: "All rows stacked; only the first file's header is kept.",
    run: async (files) => {
      const Papa = (await import("papaparse")).default;
      const all: string[][] = [];
      let header: string[] | null = null;
      for (const f of files) {
        const rows = Papa.parse<string[]>(await f.text()).data.filter((r) => r.length > 0);
        if (rows.length === 0) continue;
        if (!header) {
          header = rows[0];
          all.push(...rows);
        } else {
          all.push(...rows.slice(1));
        }
      }
      return { blob: new Blob([Papa.unparse(all)], { type: "text/csv" }), filename: "merged.csv" };
    },
  },

  // ============================================================
  // DOCUMENTS
  // ============================================================
  {
    id: "markdown",
    category: "Documents",
    title: "Markdown → …",
    description: "Render Markdown to HTML or plain text.",
    accept: ".md,.markdown,text/markdown",
    inputExts: ["MD", "MARKDOWN"],
    mode: "per-file",
    outputs: [
      {
        ext: "HTML",
        label: "HTML document",
        description: "Standalone HTML file.",
        run: async (file) => {
          const { marked } = await import("marked");
          const body = await marked.parse(await file.text());
          const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(stripExt(file.name))}</title>${body}`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Plain text",
        description: "Markdown syntax stripped.",
        run: async (file) => {
          const { marked } = await import("marked");
          const html = await marked.parse(await file.text());
          const text = htmlToText(html);
          return {
            blob: new Blob([text], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },
  {
    id: "html-to",
    category: "Documents",
    title: "HTML → …",
    description: "Convert HTML to Markdown or plain text.",
    accept: ".html,.htm,text/html",
    inputExts: ["HTML", "HTM"],
    mode: "per-file",
    outputs: [
      {
        ext: "MD",
        label: "Markdown",
        description: "Clean Markdown via Turndown.",
        run: async (file) => {
          const Turndown = (await import("turndown")).default;
          // Strip script/style first: otherwise their source code ended up as
          // text in the Markdown output.
          const md = new Turndown().turndown(stripNonContentHtml(await file.text()));
          return {
            blob: new Blob([md], { type: "text/markdown" }),
            filename: `${stripExt(file.name)}.md`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Plain text",
        description: "Tags stripped.",
        run: async (file) => {
          const text = htmlToText(await file.text());
          return {
            blob: new Blob([text], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },
  {
    id: "subtitles",
    category: "Documents",
    title: "Subtitles convert",
    description:
      "Convert subtitle files between SRT, WebVTT, and SubStation (ASS/SSA/SMI/TTML) formats.",
    accept: ".srt,.vtt,.ass,.ssa,.smi,.sami,.ttml,.dfxp,text/vtt,text/plain",
    inputExts: ["SRT", "VTT", "ASS", "SSA", "SMI", "SAMI", "TTML", "DFXP"],
    mode: "per-file",
    outputs: [
      {
        ext: "SRT",
        label: "SubRip (.srt)",
        description: "Renumbered cues with comma-style timestamps.",
        run: async (file) => {
          const cues = subtitleCues(await file.text(), getExt(file.name));
          if (cues.length === 0) throw new Error("No subtitle cues found.");
          return {
            blob: new Blob([srtFromCues(cues)], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.srt`,
          };
        },
      },
      {
        ext: "VTT",
        label: "WebVTT (.vtt)",
        description: "Adds the WEBVTT header and dot-style timestamps.",
        run: async (file) => {
          const cues = subtitleCues(await file.text(), getExt(file.name));
          if (cues.length === 0) throw new Error("No subtitle cues found.");
          return {
            blob: new Blob([vttFromCues(cues)], { type: "text/vtt" }),
            filename: `${stripExt(file.name)}.vtt`,
          };
        },
      },
      {
        ext: "ASS",
        label: "SubStation (.ass)",
        description: "SubStation Alpha script with a default style.",
        run: async (file) => {
          const cues = subtitleCues(await file.text(), getExt(file.name));
          if (cues.length === 0) throw new Error("No subtitle cues found.");
          return {
            blob: new Blob([assFromCues(cues, stripExt(file.name))], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.ass`,
          };
        },
      },
    ],
  },
  {
    id: "epub-convert",
    category: "Documents",
    title: "EPUB → HTML/TXT",
    description: "Extract an EPUB's chapters into one HTML document or plain text.",
    accept: ".epub,application/epub+zip",
    inputExts: ["EPUB"],
    mode: "per-file",
    outputs: [
      {
        ext: "HTML",
        label: "HTML (.html)",
        description: "All chapters concatenated in spine order.",
        run: async (file) => {
          const chapters = await epubChapters(file);
          const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(stripExt(file.name))}</title><main>${chapters.map((c) => `<section class="chapter">\n${c}\n</section>`).join("\n")}</main>`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Plain text (.txt)",
        description: "Chapter text with blank-line separators.",
        run: async (file) => {
          const chapters = await epubChapters(file);
          const text = chapters
            .map((c) => htmlToText(`<body>${c}</body>`).trim())
            .filter(Boolean)
            .join("\n\n");
          return {
            blob: new Blob([text], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },
  {
    id: "contacts-convert",
    category: "Documents",
    title: "vCard convert",
    description: "vCard (.vcf) address books to CSV/JSON, or CSV rows back to vCard.",
    accept: ".vcf,.vcard,.csv,text/vcard,text/x-vcard,text/directory,text/csv",
    inputExts: ["VCF", "VCARD", "CSV"],
    mode: "per-file",
    outputs: [
      {
        ext: "CSV",
        label: "CSV (.csv)",
        description: "One row per contact, spreadsheet-ready.",
        run: async (file) => {
          const rows = vcardContacts(await file.text());
          const csv =
            rows
              .map((r) =>
                [r.Name, r.FullName, r.Organization, r.Title, r.Phone, r.Email]
                  .map(csvCell)
                  .join(","),
              )
              .join("\r\n") + "\r\n";
          return {
            blob: new Blob(["\uFEFF" + csv], { type: "text/csv" }),
            filename: `${stripExt(file.name)}.csv`,
          };
        },
      },
      {
        ext: "JSON",
        label: "JSON (.json)",
        description: "Array of contact objects.",
        run: async (file) => {
          const out = JSON.stringify(vcardContacts(await file.text()), null, 2) + "\n";
          return {
            blob: new Blob([out], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
      {
        ext: "VCF",
        label: "vCard (.vcf)",
        description: "CSV (Name/Phone/Email columns) to importable vCard 3.0 records.",
        run: async (file) => {
          const rows = await csvRows(await file.text());
          const cards: string[] = [];
          for (const row of rows) {
            const pick = (...keys: string[]) => {
              const lower = new Map(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
              for (const key of keys) {
                const v = lower.get(key);
                if (v != null && String(v).trim()) return String(v).trim();
              }
              return "";
            };
            const name = pick("name", "full name", "fullname", "display name");
            if (!name) continue;
            const card = [
              "BEGIN:VCARD",
              "VERSION:3.0",
              `N:${name.replace(/([;\\,])/g, "\\$1")}`,
              `FN:${name.replace(/([;\\,])/g, "\\$1")}`,
              ...(pick("phone", "tel", "mobile", "phone number")
                ? [
                    `TEL;TYPE=cell:${pick("phone", "tel", "mobile", "phone number").replace(/([;\\,])/g, "\\$1")}`,
                  ]
                : []),
              ...(pick("email", "e-mail", "email address")
                ? [
                    `EMAIL;TYPE=work:${pick("email", "e-mail", "email address").replace(/([;\\,])/g, "\\$1")}`,
                  ]
                : []),
              ...(pick("organization", "org", "company")
                ? [`ORG:${pick("organization", "org", "company").replace(/([;\\,])/g, "\\$1")}`]
                : []),
              ...(pick("title", "job title")
                ? [`TITLE:${pick("title", "job title").replace(/([;\\,])/g, "\\$1")}`]
                : []),
              "END:VCARD",
            ].join("\r\n");
            cards.push(card);
          }
          if (cards.length === 0) throw new Error('Need a "Name" column with contact rows.');
          return {
            blob: new Blob([cards.join("\r\n") + "\r\n"], { type: "text/vcard" }),
            filename: `${stripExt(file.name)}.vcf`,
          };
        },
      },
    ],
  },
  {
    id: "calendar-ics",
    category: "Documents",
    title: "iCalendar → CSV/JSON",
    description: "Extract events from an .ics calendar into rows or JSON.",
    accept: ".ics,text/calendar",
    inputExts: ["ICS"],
    mode: "per-file",
    outputs: [
      {
        ext: "CSV",
        label: "CSV (.csv)",
        description: "One row per event (summary, start, end, location).",
        run: async (file) => {
          const rows = icsEvents(await file.text());
          const csv =
            rows
              .map((r) =>
                [r.Summary, r.Start, r.End, r.Location, r.Description].map(csvCell).join(","),
              )
              .join("\r\n") + "\r\n";
          return {
            blob: new Blob(["\uFEFF" + csv], { type: "text/csv" }),
            filename: `${stripExt(file.name)}.csv`,
          };
        },
      },
      {
        ext: "JSON",
        label: "JSON (.json)",
        description: "Array of event objects.",
        run: async (file) => {
          const out = JSON.stringify(icsEvents(await file.text()), null, 2) + "\n";
          return {
            blob: new Blob([out], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
    ],
  },
  {
    id: "lyrics-lrc",
    category: "Documents",
    title: "LRC → SRT/TXT",
    description: "Turn synced .lrc lyrics into subtitle cues or plain lyric text.",
    accept: ".lrc,text/plain",
    inputExts: ["LRC"],
    mode: "per-file",
    outputs: [
      {
        ext: "SRT",
        label: "SubRip (.srt)",
        description: "Each lyric line as a timed cue ending at the next line.",
        run: async (file) => {
          const { cues } = parseLrc(await file.text());
          if (cues.length === 0) throw new Error("No timed lyric lines found.");
          const stamp = (t: number) => {
            const h = String(Math.floor(t / 3600000)).padStart(2, "0");
            const m = String(Math.floor((t % 3600000) / 60000)).padStart(2, "0");
            const s = String(Math.floor((t % 60000) / 1000)).padStart(2, "0");
            const ms = String(t % 1000).padStart(3, "0");
            return `${h}:${m}:${s},${ms}`;
          };
          const out =
            cues
              .map((c, i) => `${i + 1}\r\n${stamp(c.start)} --> ${stamp(c.end)}\r\n${c.text}`)
              .join("\r\n\r\n") + "\r\n";
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.srt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Plain text (.txt)",
        description: "Lyric lines only (tags and timestamps stripped).",
        run: async (file) => {
          const { lines } = parseLrc(await file.text());
          const out = lines.join("\n") + "\n";
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },
  {
    id: "pdf-slides",
    category: "PDF",
    title: "PDF → PPTX/CBZ",
    description: "Turn each PDF page into a PowerPoint slide or a comic book archive.",
    accept: ".pdf,application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "PPTX",
        label: "PowerPoint (.pptx)",
        description: "One image slide per PDF page (16:9).",
        run: async (file) => {
          const { default: PptxGenJS } = await import("pptxgenjs");
          const canvases = await pdfPagesToCanvases(file, 2);
          const pptx = new PptxGenJS();
          pptx.layout = "LAYOUT_16x9";
          pptx.title = stripExt(file.name);
          for (const canvas of canvases) {
            const slide = pptx.addSlide();
            slide.addImage({
              data: canvas.toDataURL("image/png"),
              x: 0,
              y: 0,
              w: "100%",
              h: "100%",
              sizing: { type: "contain", w: "100%", h: "100%" },
            });
          }
          const out = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
          canvases.forEach((c) => (c.width = c.height = 0));
          return {
            blob: new Blob([out], {
              type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            }),
            filename: `${stripExt(file.name)}.pptx`,
          };
        },
      },
      {
        ext: "CBZ",
        label: "Comic book (.cbz)",
        description: "Each page as a numbered PNG inside a zip archive.",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const canvases = await pdfPagesToCanvases(file, 2);
          const zip = new JSZip();
          for (let i = 0; i < canvases.length; i++) {
            const blob = await new Promise<Blob | null>((resolve) =>
              canvases[i].toBlob(resolve, "image/png"),
            );
            if (!blob) throw new Error(`Page ${i + 1} could not be rasterized.`);
            zip.file(`page-${String(i + 1).padStart(3, "0")}.png`, blob);
          }
          canvases.forEach((c) => (c.width = c.height = 0));
          const out = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
          return {
            blob: out,
            filename: `${stripExt(file.name)}.cbz`,
          };
        },
      },
    ],
  },
  {
    id: "cbz-convert",
    category: "Documents",
    title: "CBZ → PDF",
    description: "Build a single PDF from the images packed in a comic book archive.",
    accept: ".cbz,.zip,application/zip,application/vnd.comicbook+zip",
    inputExts: ["CBZ"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "PDF (.pdf)",
        description: "Pages in archive order (PNG/JPG), one per PDF page.",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const { PDFDocument, rgb } = await import("pdf-lib");
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          const names = Object.keys(zip.files)
            .filter(
              (n) => /\.(png|jpe?g)$/i.test(n) && !n.includes("__MACOSX") && !zip.file(n)!.dir,
            )
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          if (names.length === 0) throw new Error("No PNG or JPG images in the archive.");
          const doc = await PDFDocument.create();
          doc.setTitle(stripExt(file.name));
          for (const name of names) {
            const data = await zip.file(name)!.async("uint8array");
            const image = /\.png$/i.test(name)
              ? await doc.embedPng(data)
              : await doc.embedJpg(data);
            const page = doc.addPage([image.width, image.height]);
            page.drawRectangle({
              x: -2,
              y: -2,
              width: image.width + 4,
              height: image.height + 4,
              color: rgb(1, 1, 1),
            });
            page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
          }
          const out = await doc.save();
          return {
            blob: new Blob([out as BlobPart], { type: "application/pdf" }),
            filename: `${stripExt(file.name)}.pdf`,
          };
        },
      },
    ],
  },
  {
    id: "svgz-convert",
    category: "Images",
    title: "SVG ↔ SVGZ",
    description: "Wrap an SVG in a gzip container or read gzipped SVGZ files back.",
    accept: ".svg,.svgz,image/svg+xml,application/gzip",
    inputExts: ["SVG", "SVGZ"],
    mode: "per-file",
    outputs: [
      {
        ext: "SVG",
        label: "SVG (.svg)",
        description: "Decompressed SVG for editors and importers.",
        run: async (file) => {
          const isSvgz = getExt(file.name).toUpperCase() === "SVGZ";
          const text = isSvgz
            ? new TextDecoder().decode(await gunzipStream(file))
            : await file.text();
          if (!/<svg[\s>]/i.test(text)) throw new Error("File does not contain a <svg> root tag.");
          return {
            blob: new Blob([text], { type: "image/svg+xml" }),
            filename: `${stripExt(file.name)}.svg`,
          };
        },
      },
      {
        ext: "GZ",
        label: "SVGZ (.svgz)",
        description: "gzip-wrapped SVG, smaller for serving and storage.",
        run: async (file) => {
          const isSvgz = getExt(file.name).toUpperCase() === "SVGZ";
          let bytes: ArrayBuffer;
          if (isSvgz) bytes = await file.arrayBuffer();
          else {
            const text = await file.text();
            if (!/<svg[\s>]/i.test(text))
              throw new Error("File does not contain a <svg> root tag.");
            bytes = await gzipStream(new TextEncoder().encode(text).buffer as ArrayBuffer);
          }
          return {
            blob: new Blob([bytes], { type: "application/gzip" }),
            filename: `${stripExt(file.name)}.svgz`,
          };
        },
      },
    ],
  },
  {
    id: "ipynb-convert",
    category: "Developer",
    title: "Notebook → MD/PY",
    description: "Flatten a Jupyter notebook (.ipynb) into Markdown or a script file.",
    accept: ".ipynb,application/x-ipynb+json",
    inputExts: ["IPYNB"],
    mode: "per-file",
    outputs: [
      {
        ext: "MD",
        label: "Markdown (.md)",
        description: "Cells in order, code as fenced blocks with text outputs.",
        run: async (file) => {
          const { md } = ipynbToParts(await file.text());
          if (!md.trim()) throw new Error("The notebook has no cells.");
          return {
            blob: new Blob([md], { type: "text/markdown" }),
            filename: `${stripExt(file.name)}.md`,
          };
        },
      },
      {
        ext: "PY",
        label: "Python script (.py)",
        description: "Markdown cells as comments, code cells as script chunks.",
        run: async (file) => {
          const { py } = ipynbToParts(await file.text());
          if (!py.trim()) throw new Error("The notebook has no cells.");
          return {
            blob: new Blob([py], { type: "text/x-python" }),
            filename: `${stripExt(file.name)}.py`,
          };
        },
      },
      {
        ext: "HTML",
        label: "HTML (.html)",
        description: "Markdown rendered with marked and wrapped in a page.",
        run: async (file) => {
          const { md } = ipynbToParts(await file.text());
          if (!md.trim()) throw new Error("The notebook has no cells.");
          const marked = (await import("marked")).marked;
          const body = marked.parse(md);
          const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(stripExt(file.name))}</title><main>${body}</main>`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
    ],
  },
  {
    id: "fb2-convert",
    category: "Documents",
    title: "FB2 → HTML/TXT",
    description: "Extract a FictionBook (.fb2) e-book into HTML or plain text.",
    accept: ".fb2,text/xml,application/xml",
    inputExts: ["FB2"],
    mode: "per-file",
    outputs: [
      {
        ext: "HTML",
        label: "HTML (.html)",
        description: "Sections, titles, tables and verse mapped to HTML tags.",
        run: async (file) => {
          const body = await fb2ToHtml(await file.text());
          const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(stripExt(file.name))}</title><main>${body}</main>`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Plain text (.txt)",
        description: "Rendered HTML stripped down to text.",
        run: async (file) => {
          const stripped = htmlToText(`<body>${await fb2ToHtml(await file.text())}</body>`).trim();
          if (!stripped) throw new Error("No FB2 body content found.");
          return {
            blob: new Blob([stripped], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },
  {
    id: "geo-convert",
    category: "Data",
    title: "GPX/KML → CSV/JSON",
    description: "Extract coordinates from GPS tracks and map placemarks into tables.",
    accept: ".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml",
    inputExts: ["GPX", "KML"],
    mode: "per-file",
    outputs: [
      {
        ext: "CSV",
        label: "CSV (.csv)",
        description: "lat, lon, ele, time, name - spreadsheet import ready.",
        run: async (file) => {
          const isGpx = getExt(file.name).toUpperCase() === "GPX";
          const points = isGpx ? await gpxPoints(await file.text()) : kmlPoints(await file.text());
          if (points.length === 0) throw new Error("No coordinates found.");
          const csv =
            points
              .map((p) =>
                [
                  p.lat.toFixed(6),
                  p.lon.toFixed(6),
                  p.ele != null ? String(p.ele) : "",
                  p.time ?? "",
                  p.name ?? "",
                ]
                  .map(csvCell)
                  .join(","),
              )
              .join("\r\n") + "\r\n";
          return {
            blob: new Blob(["\uFEFF" + csv], { type: "text/csv" }),
            filename: `${stripExt(file.name)}.csv`,
          };
        },
      },
      {
        ext: "JSON",
        label: "JSON (.json)",
        description: "Array of point objects (lat/lon plus optional fields).",
        run: async (file) => {
          const isGpx = getExt(file.name).toUpperCase() === "GPX";
          const points = isGpx ? await gpxPoints(await file.text()) : kmlPoints(await file.text());
          if (points.length === 0) throw new Error("No coordinates found.");
          const out = JSON.stringify(points, null, 2) + "\n";
          return {
            blob: new Blob([out], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
    ],
  },
  {
    id: "eml-convert",
    category: "Documents",
    title: "EML → TEXT/HTML",
    description: "Decode a saved email (.eml) into readable text, HTML or attachments.",
    accept: ".eml,message/rfc822",
    inputExts: ["EML"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Plain text (.txt)",
        description: "Subject, sender, date and the decoded body.",
        run: async (file) => {
          const mail = emlContent(await file.text());
          const header = [
            `Subject: ${mail.subject}`,
            `From: ${mail.from}`,
            `To: ${mail.to}`,
            `Date: ${mail.date}`,
            "",
          ].join("\n");
          const body = (mail.bodyText || htmlToText(mail.bodyHtml) || "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          if (!body && mail.attachments.length === 0)
            throw new Error("No readable body or attachments found.");
          return {
            blob: new Blob([`${header}${body}`], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
      {
        ext: "HTML",
        label: "HTML (.html)",
        description: "The original HTML body when present, else text wrapped in HTML.",
        run: async (file) => {
          const mail = emlContent(await file.text());
          const meta = `${escapeHtml(mail.subject)} - ${escapeHtml(mail.from)} - ${escapeHtml(mail.date)}`;
          const content = mail.bodyHtml || `<pre>${escapeHtml(mail.bodyText)}</pre>`;
          if (!mail.bodyHtml && !mail.bodyText && mail.attachments.length === 0)
            throw new Error("No readable body or attachments found.");
          const html = `<!doctype html><meta charset="utf-8"><title>${meta}</title><main>${content}</main>`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
      {
        ext: "ZIP",
        label: "Attachments (.zip)",
        description: "Every file attachment decoded into a zip archive.",
        run: async (file) => {
          const mail = emlContent(await file.text());
          if (mail.attachments.length === 0) throw new Error("The email has no attachments.");
          const { default: JSZip } = await import("jszip");
          const zip = new JSZip();
          mail.attachments.forEach((a, i) => {
            const name = a.name || `attachment-${i + 1}`;
            zip.file(name, a.bytes);
          });
          const out = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
          return {
            blob: out,
            filename: `${stripExt(file.name)}-attachments.zip`,
          };
        },
      },
    ],
  },
  {
    id: "word",
    category: "Documents",
    title: "Word → …",
    description: "Convert Word (.docx) to HTML, Markdown or plain text.",
    accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    inputExts: ["DOCX"],
    mode: "per-file",
    outputs: [
      {
        ext: "HTML",
        label: "HTML document",
        description: "Preserves basic formatting.",
        run: async (file) => {
          const mammoth = await import("mammoth");
          const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
          const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(stripExt(file.name))}</title>${value}`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
      {
        ext: "MD",
        label: "Markdown",
        description: "HTML → Markdown via Turndown.",
        run: async (file) => {
          const mammoth = await import("mammoth");
          const Turndown = (await import("turndown")).default;
          const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
          const md = new Turndown().turndown(value);
          return {
            blob: new Blob([md], { type: "text/markdown" }),
            filename: `${stripExt(file.name)}.md`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Plain text",
        description: "Raw text, no formatting.",
        run: async (file) => {
          const mammoth = await import("mammoth");
          const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          return {
            blob: new Blob([value], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
      {
        ext: "PDF",
        label: "PDF (text-only)",
        description: "Very simple PDF with the raw text of the document.",
        run: async (file) => {
          const mammoth = await import("mammoth");
          const { PDFDocument, StandardFonts } = await import("pdf-lib");
          const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          const doc = await PDFDocument.create();
          const font = await doc.embedFont(StandardFonts.Helvetica);
          const size = 11;
          const margin = 50;
          const lineHeight = 14;
          const pageWidth = 595;
          const pageHeight = 842;
          const maxWidth = pageWidth - margin * 2;
          const paragraphs = value.split(/\n+/);
          let page = doc.addPage([pageWidth, pageHeight]);
          let y = pageHeight - margin;
          for (const para of paragraphs) {
            const words = para.split(/\s+/);
            let line = "";
            for (const w of words) {
              const test = line ? line + " " + w : w;
              if (font.widthOfTextAtSize(test, size) > maxWidth) {
                page.drawText(line, { x: margin, y, size, font });
                y -= lineHeight;
                if (y < margin) {
                  page = doc.addPage([pageWidth, pageHeight]);
                  y = pageHeight - margin;
                }
                line = w;
              } else {
                line = test;
              }
            }
            if (line) {
              page.drawText(line, { x: margin, y, size, font });
              y -= lineHeight;
            }
            y -= lineHeight / 2;
            if (y < margin) {
              page = doc.addPage([pageWidth, pageHeight]);
              y = pageHeight - margin;
            }
          }
          const bytes = await doc.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `${stripExt(file.name)}.pdf`,
          };
        },
      },
    ],
  },
  {
    id: "text-to-pdf",
    category: "Documents",
    title: "Text → PDF",
    description: "Wrap a .txt / .md / .csv file as a printable PDF.",
    accept: ".txt,.md,.csv,.log,text/plain",
    inputExts: ["TXT", "MD", "CSV", "LOG"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "A4 PDF",
        description: "Monospaced text laid out on A4 pages.",
        run: async (file) => {
          const { PDFDocument, StandardFonts } = await import("pdf-lib");
          const doc = await PDFDocument.create();
          const font = await doc.embedFont(StandardFonts.Courier);
          const size = 10;
          const margin = 40;
          const pw = 595;
          const ph = 842;
          const maxWidth = pw - margin * 2;
          let page = doc.addPage([pw, ph]);
          let y = ph - margin;
          const lines = (await file.text()).split(/\r?\n/);
          for (const raw of lines) {
            const chunks: string[] = [];
            let line = "";
            for (const ch of raw) {
              const t = line + ch;
              if (font.widthOfTextAtSize(t, size) > maxWidth) {
                chunks.push(line);
                line = ch;
              } else {
                line = t;
              }
            }
            chunks.push(line);
            for (const c of chunks) {
              if (y < margin) {
                page = doc.addPage([pw, ph]);
                y = ph - margin;
              }
              page.drawText(c, { x: margin, y, size, font });
              y -= size + 3;
            }
          }
          const bytes = await doc.save();
          return {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            filename: `${stripExt(file.name)}.pdf`,
          };
        },
      },
    ],
  },
  {
    id: "text-lines",
    category: "Documents",
    title: "Sort / dedupe / reverse lines",
    description: "Common line-based text transforms.",
    accept: ".txt,.md,.log,.csv,text/plain",
    inputExts: ["TXT", "MD", "LOG", "CSV"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Sort A→Z",
        description: "Alphabetical ascending sort.",
        run: async (file) => ({
          blob: new Blob([(await file.text()).split(/\r?\n/).sort().join("\n")], {
            type: "text/plain",
          }),
          filename: `sorted-${file.name}`,
        }),
      },
      {
        ext: "TXT",
        label: "Sort Z→A",
        description: "Alphabetical descending sort.",
        run: async (file) => ({
          blob: new Blob([(await file.text()).split(/\r?\n/).sort().reverse().join("\n")], {
            type: "text/plain",
          }),
          filename: `sorted-desc-${file.name}`,
        }),
      },
      {
        ext: "TXT",
        label: "Deduplicate",
        description: "Removes duplicate lines (order preserved).",
        run: async (file) => {
          const seen = new Set<string>();
          const out = (await file.text()).split(/\r?\n/).filter((l) => {
            if (seen.has(l)) return false;
            seen.add(l);
            return true;
          });
          return {
            blob: new Blob([out.join("\n")], { type: "text/plain" }),
            filename: `dedup-${file.name}`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Reverse order",
        description: "Bottom line becomes the first.",
        run: async (file) => ({
          blob: new Blob([(await file.text()).split(/\r?\n/).reverse().join("\n")], {
            type: "text/plain",
          }),
          filename: `reversed-${file.name}`,
        }),
      },
      {
        ext: "TXT",
        label: "Trim whitespace",
        description: "Trim each line + drop blank lines.",
        run: async (file) => {
          const out = (await file.text())
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          return {
            blob: new Blob([out.join("\n")], { type: "text/plain" }),
            filename: `trim-${file.name}`,
          };
        },
      },
    ],
  },

  // ============================================================
  // ENCODERS / TEXT UTILITIES
  // ============================================================
  {
    id: "encode-base64",
    category: "Encoders",
    title: "File → Base64 / Data URL",
    description: "Encode ANY file as Base64 or a data: URL.",
    accept: "*/*",
    inputExts: ["ANY"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Base64",
        description: "Raw base64 bytes.",
        run: async (file) => {
          const b64 = await bytesToBase64(await file.arrayBuffer());
          return {
            blob: new Blob([b64], { type: "text/plain" }),
            filename: `${file.name}.b64.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Data URL",
        description: "`data:mime;base64,…` string.",
        run: async (file) => {
          const b64 = await bytesToBase64(await file.arrayBuffer());
          const url = `data:${file.type || "application/octet-stream"};base64,${b64}`;
          return {
            blob: new Blob([url], { type: "text/plain" }),
            filename: `${file.name}.dataurl.txt`,
          };
        },
      },
    ],
  },
  {
    id: "decode-base64",
    category: "Encoders",
    title: "Base64 → File",
    description: "Decode a Base64 or data URL text file back to bytes.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "BIN",
        label: "Decoded bytes",
        description: "Restores the original file bytes.",
        run: async (file) => {
          let text = (await file.text()).trim();
          let mime = "application/octet-stream";
          let ext = "bin";
          if (text.startsWith("data:")) {
            const m = text.match(/^data:([^;]+);base64,(.*)$/s);
            if (!m) throw new Error("Malformed data URL");
            mime = m[1];
            ext = mime.split("/")[1] || "bin";
            text = m[2];
          }
          const bin = atob(text.replace(/\s+/g, ""));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return {
            blob: new Blob([bytes], { type: mime }),
            filename: `${stripExt(file.name)}.${ext}`,
          };
        },
      },
    ],
  },
  {
    id: "url-codec",
    category: "Encoders",
    title: "URL encode / decode",
    description: "Percent-encode or decode a text file.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "URL encode",
        description: "`encodeURIComponent` applied to the whole text.",
        run: async (file) => ({
          blob: new Blob([encodeURIComponent(await file.text())], { type: "text/plain" }),
          filename: `urlenc-${file.name}`,
        }),
      },
      {
        ext: "TXT",
        label: "URL decode",
        description: "Reverses percent-encoding.",
        run: async (file) => {
          const text = await file.text();
          let decoded: string;
          try {
            decoded = decodeURIComponent(text);
          } catch {
            throw new Error("Input is not valid URL-encoded text.");
          }
          return {
            blob: new Blob([decoded], { type: "text/plain" }),
            filename: `urldec-${file.name}`,
          };
        },
      },
    ],
  },
  {
    id: "html-entities",
    category: "Encoders",
    title: "HTML entities encode / decode",
    description: "Escape < > & \" ' or decode named/numeric entities.",
    accept: ".txt,.html,text/plain,text/html",
    inputExts: ["TXT", "HTML", "HTM"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Encode",
        description: "Escapes reserved HTML characters.",
        run: async (file) => {
          const map: Record<string, string> = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          };
          const out = (await file.text()).replace(/[&<>"']/g, (c) => map[c]);
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `entities-${file.name}`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Decode",
        description: "Turns HTML entities back into characters.",
        run: async (file) => {
          const doc = new DOMParser().parseFromString(await file.text(), "text/html");
          return {
            blob: new Blob([doc.documentElement.textContent ?? ""], { type: "text/plain" }),
            filename: `decoded-${file.name}`,
          };
        },
      },
    ],
  },
  {
    id: "hex-codec",
    category: "Encoders",
    title: "Hex encode / decode",
    description: "Convert bytes ↔ hex string.",
    accept: "*/*",
    inputExts: ["ANY"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "File → Hex",
        description: "Lowercase hex, no spaces.",
        run: async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let s = "";
          for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
          return { blob: new Blob([s], { type: "text/plain" }), filename: `${file.name}.hex.txt` };
        },
      },
    ],
  },
  {
    id: "hex-decode",
    category: "Encoders",
    title: "Hex → File",
    description: "Decode a hex-encoded text file back to bytes.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "BIN",
        label: "Decoded bytes",
        description: "Restores the original file bytes.",
        run: async (file) => {
          const hex = (await file.text()).replace(/\s+/g, "");
          if (hex.length % 2) throw new Error("Odd hex length");
          const bytes = new Uint8Array(hex.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
          return { blob: new Blob([bytes]), filename: `${stripExt(file.name)}.bin` };
        },
      },
    ],
  },
  {
    id: "binary-codec",
    category: "Encoders",
    title: "Binary (0/1) encode",
    description: "Turn any file into a stream of 0s and 1s (or back).",
    accept: "*/*",
    inputExts: ["ANY"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "File → 0/1",
        description: "Space-separated 8-bit binary bytes.",
        run: async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const chunks: string[] = [];
          for (let i = 0; i < bytes.length; i++) chunks.push(bytes[i].toString(2).padStart(8, "0"));
          return {
            blob: new Blob([chunks.join(" ")], { type: "text/plain" }),
            filename: `${file.name}.bin.txt`,
          };
        },
      },
    ],
  },
  {
    id: "hash-file",
    category: "Encoders",
    title: "Hash a file",
    description: "Compute SHA-1 / SHA-256 / SHA-384 / SHA-512 of any file.",
    accept: "*/*",
    inputExts: ["ANY"],
    mode: "per-file",
    outputs: [
      ...(["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const).map((algo) => ({
        ext: "TXT",
        label: algo,
        description: `${algo} hash (hex).`,
        run: async (file: File) => {
          const h = await hash(algo, await file.arrayBuffer());
          return {
            blob: new Blob([h], { type: "text/plain" }),
            filename: `${file.name}.${algo.toLowerCase().replace("-", "")}.txt`,
          };
        },
      })),
    ],
  },
  {
    id: "jwt-decode",
    category: "Encoders",
    title: "JWT decode",
    description: "Split a JWT into its decoded header + payload JSON.",
    accept: ".txt,.jwt,text/plain",
    inputExts: ["TXT", "JWT"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Decoded JSON",
        description: "{ header, payload } - signature is NOT verified.",
        run: async (file) => {
          const token = (await file.text()).trim();
          const parts = token.split(".");
          if (parts.length < 2) throw new Error("Not a JWT");
          const out = { header: decodeJwtPart(parts[0]), payload: decodeJwtPart(parts[1]) };
          return {
            blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
    ],
  },
  {
    id: "qr-generate",
    category: "Encoders",
    title: "Text → QR code",
    description: "Generate a QR code PNG from the file's contents.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "QR code (.png)",
        description: "512×512 PNG QR code, error-correction level M.",
        run: async (file) => {
          const QR = (await import("qrcode")).default;
          const url = await QR.toDataURL(await file.text(), {
            width: 512,
            margin: 2,
            errorCorrectionLevel: "M",
          });
          const bin = atob(url.split(",")[1]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return {
            blob: new Blob([bytes], { type: "image/png" }),
            filename: `${stripExt(file.name)}-qr.png`,
          };
        },
      },
      {
        ext: "SVG",
        label: "QR code (.svg)",
        description: "Vector QR code, infinitely scalable.",
        run: async (file) => {
          const QR = (await import("qrcode")).default;
          const svg = await QR.toString(await file.text(), { type: "svg", margin: 2 });
          return {
            blob: new Blob([svg], { type: "image/svg+xml" }),
            filename: `${stripExt(file.name)}-qr.svg`,
          };
        },
      },
    ],
  },
  {
    id: "qr-read",
    category: "Encoders",
    title: "QR code → Text",
    description: "Scan a PNG/JPG of a QR code and return the decoded text.",
    accept: "image/*",
    inputExts: ["PNG", "JPG", "JPEG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Decoded text",
        description: "The QR payload as plain text.",
        run: async (file) => {
          const jsQR = (await import("jsqr")).default;
          const c = await imageToCanvas(file);
          const img = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
          const code = jsQR(img.data, c.width, c.height);
          if (!code) throw new Error("No QR code detected in this image");
          return {
            blob: new Blob([code.data], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },

  // ============================================================
  // ARCHIVES
  // ============================================================
  {
    id: "files-to-zip",
    category: "Archives",
    title: "Files → ZIP",
    description: "Bundle any files into a single ZIP archive.",
    accept: "*/*",
    inputExts: ["ANY"],
    mode: "combine",
    outputExt: "ZIP",
    outputLabel: "ZIP archive",
    outputDescription: "All dropped files bundled into archive.zip.",
    run: async (files) => {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f);
      return { blob: await zip.generateAsync({ type: "blob" }), filename: "archive.zip" };
    },
  },
  {
    id: "zip-repack",
    category: "Archives",
    title: "Repack ZIP",
    description: "Extract a ZIP and repack it (round-trip / re-compress).",
    accept: ".zip,application/zip",
    inputExts: ["ZIP"],
    mode: "per-file",
    outputs: [
      {
        ext: "ZIP",
        label: "Repacked ZIP",
        description: "Re-compressed archive with the same contents.",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const src = await JSZip.loadAsync(await file.arrayBuffer());
          const out = new JSZip();
          for (const entry of Object.values(src.files)) {
            if (entry.dir) continue;
            out.file(entry.name, await entry.async("uint8array"));
          }
          return {
            blob: await out.generateAsync({ type: "blob" }),
            filename: `repacked-${file.name}`,
          };
        },
      },
    ],
  },
  {
    id: "zip-to-tarlike-json",
    category: "Archives",
    title: "ZIP → File listing",
    description: "List every file inside a ZIP as JSON (name, size, date).",
    accept: ".zip,application/zip",
    inputExts: ["ZIP"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Manifest JSON",
        description: "Array of `{ name, size, date, dir }` entries.",
        run: async (file) => {
          const { default: JSZip } = await import("jszip");
          const src = await JSZip.loadAsync(await file.arrayBuffer());
          const manifest = await Promise.all(
            Object.values(src.files).map(async (e) => {
              const size = e.dir ? 0 : (await e.async("uint8array")).byteLength;
              return { name: e.name, size, date: e.date, dir: e.dir };
            }),
          );
          return {
            blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-manifest.json`,
          };
        },
      },
    ],
  },

  // ============================================================
  // VIDEO (ffmpeg.wasm - heavy first load, ~30MB)
  // ============================================================
  {
    id: "video-convert",
    category: "Video",
    title: "Convert video",
    description: "Re-encode video into MP4, WEBM or MOV. Uses ffmpeg.wasm (large first-load).",
    accept: "video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v",
    inputExts: ["MP4", "WEBM", "MOV", "MKV", "AVI", "M4V"],
    mode: "per-file",
    outputs: [
      {
        ext: "MP4",
        label: "MP4 (H.264 + AAC)",
        description: "Widely compatible MP4 container with H.264 video and AAC audio.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => [
              "-i",
              i,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "23",
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              o,
            ],
            "MP4",
            "video/mp4",
          );
        },
      },
      {
        ext: "WEBM",
        label: "WEBM (VP9 + Opus)",
        description: "Open WebM container with VP9 video and Opus audio.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => [
              "-i",
              i,
              "-c:v",
              "libvpx-vp9",
              "-b:v",
              "1M",
              "-c:a",
              "libopus",
              "-b:a",
              "96k",
              o,
            ],
            "WEBM",
            "video/webm",
          );
        },
      },
      {
        ext: "MOV",
        label: "MOV (H.264 + AAC)",
        description: "QuickTime container with H.264 + AAC.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => [
              "-i",
              i,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "23",
              "-c:a",
              "aac",
              o,
            ],
            "MOV",
            "video/quicktime",
          );
        },
      },
    ],
  },
  {
    id: "video-compress",
    category: "Video",
    title: "Compress video",
    description: "Shrink video size with H.264 (CRF 28). Good quality, smaller file.",
    accept: "video/*",
    inputExts: ["MP4", "WEBM", "MOV", "MKV", "AVI", "M4V"],
    mode: "per-file",
    outputs: [
      {
        ext: "MP4",
        label: "Compressed MP4",
        description: "H.264 CRF 28 + 96k AAC audio.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => [
              "-i",
              i,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "28",
              "-c:a",
              "aac",
              "-b:a",
              "96k",
              o,
            ],
            "MP4",
            "video/mp4",
          );
        },
      },
    ],
  },
  {
    id: "video-mute",
    category: "Video",
    title: "Mute video",
    description: "Remove the audio track from a video, keeping the picture intact.",
    accept: "video/*",
    inputExts: ["MP4", "WEBM", "MOV", "MKV", "AVI", "M4V"],
    mode: "per-file",
    outputs: [
      {
        ext: "MP4",
        label: "Muted MP4",
        description: "Original video stream, audio stripped.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(file, (i, o) => ["-i", i, "-c:v", "copy", "-an", o], "MP4", "video/mp4");
        },
      },
    ],
  },
  {
    id: "video-to-gif",
    category: "Video",
    title: "Video → GIF",
    description: "Convert the first 5 seconds of a video into an animated GIF (10fps, 480px wide).",
    accept: "video/*",
    inputExts: ["MP4", "WEBM", "MOV", "MKV", "AVI", "M4V"],
    mode: "per-file",
    outputs: [
      {
        ext: "GIF",
        label: "Animated GIF",
        description: "First 5 seconds, 10fps, scaled to 480px wide.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-t", "5", "-i", i, "-vf", "fps=10,scale=480:-1:flags=lanczos", o],
            "GIF",
            "image/gif",
          );
        },
      },
    ],
  },
  {
    id: "video-extract-frame",
    category: "Video",
    title: "Extract first frame",
    description: "Pull the very first frame of a video as a PNG or JPG image.",
    accept: "video/*",
    inputExts: ["MP4", "WEBM", "MOV", "MKV", "AVI", "M4V"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "Frame → PNG",
        description: "Lossless PNG snapshot of frame 1.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(file, (i, o) => ["-i", i, "-frames:v", "1", o], "PNG", "image/png");
        },
      },
      {
        ext: "JPG",
        label: "Frame → JPG",
        description: "Smaller JPEG snapshot of frame 1.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-frames:v", "1", "-q:v", "3", o],
            "JPG",
            "image/jpeg",
          );
        },
      },
    ],
  },
  {
    id: "video-to-audio",
    category: "Video",
    title: "Video → Audio",
    description: "Extract the audio track from any video as MP3, WAV or OGG.",
    accept: "video/*",
    inputExts: ["MP4", "WEBM", "MOV", "MKV", "AVI", "M4V"],
    mode: "per-file",
    outputs: [
      {
        ext: "MP3",
        label: "MP3 (192kbps)",
        description: "Extracted audio encoded as MP3 at 192kbps.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", o],
            "MP3",
            "audio/mpeg",
          );
        },
      },
      {
        ext: "WAV",
        label: "WAV (uncompressed)",
        description: "Extracted audio as PCM WAV.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(file, (i, o) => ["-i", i, "-vn", o], "WAV", "audio/wav");
        },
      },
      {
        ext: "OGG",
        label: "OGG (Vorbis)",
        description: "Extracted audio as OGG Vorbis.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-vn", "-c:a", "libvorbis", "-q:a", "5", o],
            "OGG",
            "audio/ogg",
          );
        },
      },
    ],
  },

  // ============================================================
  // AUDIO (ffmpeg.wasm)
  // ============================================================
  {
    id: "audio-convert",
    category: "Audio",
    title: "Convert audio",
    description: "Re-encode audio into MP3, WAV, OGG, M4A or FLAC.",
    accept: "audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.wma",
    inputExts: ["MP3", "WAV", "OGG", "M4A", "AAC", "FLAC", "OPUS", "WMA"],
    mode: "per-file",
    outputs: [
      {
        ext: "MP3",
        label: "MP3 (192kbps)",
        description: "Universally compatible MP3 at 192kbps.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-c:a", "libmp3lame", "-b:a", "192k", o],
            "MP3",
            "audio/mpeg",
          );
        },
      },
      {
        ext: "WAV",
        label: "WAV (PCM)",
        description: "Lossless PCM WAV.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(file, (i, o) => ["-i", i, o], "WAV", "audio/wav");
        },
      },
      {
        ext: "OGG",
        label: "OGG (Vorbis)",
        description: "Open Vorbis-encoded OGG.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-c:a", "libvorbis", "-q:a", "5", o],
            "OGG",
            "audio/ogg",
          );
        },
      },
      {
        ext: "M4A",
        label: "M4A (AAC)",
        description: "AAC audio in an MP4 container.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-c:a", "aac", "-b:a", "192k", o],
            "M4A",
            "audio/mp4",
          );
        },
      },
      {
        ext: "FLAC",
        label: "FLAC (lossless)",
        description: "Lossless FLAC compression.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(file, (i, o) => ["-i", i, "-c:a", "flac", o], "FLAC", "audio/flac");
        },
      },
    ],
  },
  {
    id: "audio-compress",
    category: "Audio",
    title: "Compress audio",
    description: "Shrink audio size by re-encoding to MP3 at 96kbps mono.",
    accept: "audio/*",
    inputExts: ["MP3", "WAV", "OGG", "M4A", "AAC", "FLAC", "OPUS", "WMA"],
    mode: "per-file",
    outputs: [
      {
        ext: "MP3",
        label: "Compressed MP3",
        description: "Mono MP3 at 96kbps - small, voice-friendly.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", o],
            "MP3",
            "audio/mpeg",
          );
        },
      },
    ],
  },
  {
    id: "audio-normalize",
    category: "Audio",
    title: "Normalize audio",
    description: "Even out loudness with EBU R128 loudness normalization.",
    accept: "audio/*",
    inputExts: ["MP3", "WAV", "OGG", "M4A", "AAC", "FLAC", "OPUS", "WMA"],
    mode: "per-file",
    outputs: [
      {
        ext: "MP3",
        label: "Normalized MP3",
        description: "Loudness normalized (loudnorm), re-encoded to MP3 192kbps.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-af", "loudnorm", "-c:a", "libmp3lame", "-b:a", "192k", o],
            "MP3",
            "audio/mpeg",
          );
        },
      },
    ],
  },
  {
    id: "audio-reverse",
    category: "Audio",
    title: "Reverse audio",
    description: "Play audio backwards. Fun for stingers and secret-messages.",
    accept: "audio/*",
    inputExts: ["MP3", "WAV", "OGG", "M4A", "AAC", "FLAC", "OPUS", "WMA"],
    mode: "per-file",
    outputs: [
      {
        ext: "MP3",
        label: "Reversed MP3",
        description: "Reversed audio encoded as MP3 192kbps.",
        run: async (file) => {
          const { runFFmpeg } = await import("./ffmpeg");
          return runFFmpeg(
            file,
            (i, o) => ["-i", i, "-af", "areverse", "-c:a", "libmp3lame", "-b:a", "192k", o],
            "MP3",
            "audio/mpeg",
          );
        },
      },
    ],
  },

  // ============================================================
  // Vision (large first-load - models cached after first use)
  // ============================================================
  {
    id: "ocr-image",
    category: "Vision",
    title: "OCR: image → text",
    description:
      "Extract text from an image using Tesseract.js (English). ~15MB one-time download.",
    accept: "image/*",
    inputExts: ["PNG", "JPG", "JPEG", "WEBP", "BMP", "GIF"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Plain text",
        description: "Recognized text as a UTF-8 .txt file.",
        run: async (file) => {
          const { withConcurrency, LIMITS } = await import("./limits");
          return withConcurrency(LIMITS.tesseract.key, LIMITS.tesseract.max, async () => {
            const { recognize } = await import("tesseract.js");
            const { data } = await recognize(file, "eng");
            return {
              blob: new Blob([data.text], { type: "text/plain" }),
              filename: `${stripExt(file.name)}.txt`,
            };
          });
        },
      },
    ],
  },
  {
    id: "ocr-pdf",
    category: "Vision",
    title: "OCR: PDF → text",
    description: "Render each PDF page and OCR it. Great for scanned PDFs. Slow on large files.",
    accept: ".pdf,application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Plain text",
        description: "Concatenated OCR text of every page.",
        run: async (file) => {
          const { withConcurrency, LIMITS } = await import("./limits");
          return withConcurrency(LIMITS.tesseract.key, LIMITS.tesseract.max, async () => {
            const pdfjs = await loadPdfjs();
            const { createWorker } = await import("tesseract.js");
            const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
            const doc = await task.promise;
            const worker = await createWorker("eng");
            const parts: string[] = [];
            try {
              for (let i = 1; i <= doc.numPages; i++) {
                const page = await doc.getPage(i);
                const viewport = page.getViewport({ scale: 2 });
                const canvas = document.createElement("canvas");
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                const ctx = canvas.getContext("2d")!;
                await page.render({ canvasContext: ctx, viewport, canvas }).promise;
                const blob: Blob = await new Promise((res, rej) =>
                  canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/png"),
                );
                const { data } = await worker.recognize(blob);
                parts.push(`\n\n--- Page ${i} ---\n${data.text}`);
              }
            } finally {
              await worker.terminate();
              task.destroy();
            }
            return {
              blob: new Blob([parts.join("\n")], { type: "text/plain" }),
              filename: `${stripExt(file.name)}.txt`,
            };
          });
        },
      },
    ],
  },
  {
    id: "remove-bg",
    category: "Vision",
    title: "Remove background",
    description:
      "AI-powered background removal to a transparent PNG. ~40MB one-time model download.",
    accept: "image/*",
    inputExts: ["PNG", "JPG", "JPEG", "WEBP", "BMP"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "Cutout PNG",
        description: "Subject on a transparent background, encoded as PNG.",
        run: async (file) => {
          const { withConcurrency, LIMITS } = await import("./limits");
          return withConcurrency(LIMITS.bgRemoval.key, LIMITS.bgRemoval.max, async () => {
            const { removeBackground } = await import("@imgly/background-removal");
            const blob = await removeBackground(file);
            return { blob, filename: `${stripExt(file.name)}-cutout.png` };
          });
        },
      },
    ],
  },
  {
    id: "upscale-image",
    category: "Vision",
    title: "Upscale image",
    description: "Enlarge an image 2× or 4× using high-quality Lanczos resampling.",
    accept: "image/*",
    inputExts: ["PNG", "JPG", "JPEG", "WEBP", "BMP", "GIF"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "2× upscale (PNG)",
        description: "Doubled dimensions with high-quality smoothing.",
        run: async (file) => {
          const src = await imageToCanvas(file);
          const dst = document.createElement("canvas");
          dst.width = src.width * 2;
          dst.height = src.height * 2;
          const ctx = dst.getContext("2d")!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(src, 0, 0, dst.width, dst.height);
          const blob = await canvasToBlob(dst, "image/png");
          return { blob, filename: `${stripExt(file.name)}@2x.png` };
        },
      },
      {
        ext: "PNG",
        label: "4× upscale (PNG)",
        description: "Quadrupled dimensions with high-quality smoothing.",
        run: async (file) => {
          const src = await imageToCanvas(file);
          const dst = document.createElement("canvas");
          dst.width = src.width * 4;
          dst.height = src.height * 4;
          const ctx = dst.getContext("2d")!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(src, 0, 0, dst.width, dst.height);
          const blob = await canvasToBlob(dst, "image/png");
          return { blob, filename: `${stripExt(file.name)}@4x.png` };
        },
      },
    ],
  },

  // ============================================================
  // MORE IMAGES
  // ============================================================
  {
    id: "heic-convert",
    category: "Images",
    title: "HEIC → JPG/PNG",
    description: "Convert iPhone HEIC/HEIF photos into browser-friendly JPG or PNG.",
    accept: ".heic,.heif,image/heic,image/heif",
    inputExts: ["HEIC", "HEIF"],
    mode: "per-file",
    outputs: [
      {
        ext: "JPG",
        label: "JPG",
        description: "High-quality JPEG (0.92).",
        run: async (file) => {
          const { default: heic2any } = await import("heic2any");
          const out = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 })) as
            Blob | Blob[];
          // Live Photos come back as an array (stills + video frames); keep the first.
          const blob = Array.isArray(out) ? out[0] : out;
          return { blob, filename: `${stripExt(file.name)}.jpg` };
        },
      },
      {
        ext: "PNG",
        label: "PNG",
        description: "Lossless PNG.",
        run: async (file) => {
          const { default: heic2any } = await import("heic2any");
          const out = (await heic2any({ blob: file, toType: "image/png" })) as Blob | Blob[];
          const blob = Array.isArray(out) ? out[0] : out;
          return { blob, filename: `${stripExt(file.name)}.png` };
        },
      },
    ],
  },
  {
    id: "exif-viewer",
    category: "Images",
    title: "EXIF viewer",
    description: "Dump all EXIF/XMP/IPTC metadata from a photo as JSON.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "HEIC", "TIFF", "TIF"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Metadata JSON",
        description: "All readable EXIF/XMP/IPTC/GPS tags.",
        run: async (file) => {
          const ExifReader = (await import("exifreader")).default;
          const tags = await ExifReader.load(await file.arrayBuffer(), { expanded: true });
          const clean = JSON.parse(
            JSON.stringify(tags, (_k, v) => (v instanceof Uint8Array ? `[${v.length} bytes]` : v)),
          );
          return {
            blob: new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-exif.json`,
          };
        },
      },
    ],
  },
  {
    id: "image-color-palette",
    category: "Images",
    title: "Color palette",
    description: "Extract the dominant palette from an image.",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP", "GIF"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Palette JSON",
        description: "Dominant colour + top 8 palette entries as hex.",
        run: async (file) => {
          // colorthief v3 is a function API (`getColor` / `getPalette`), not the
          // old `new ColorThief()` constructor: the previous call threw
          // "t is not a constructor" for every image.
          const { getColor, getPalette } = await import("colorthief");
          const img = new Image();
          const url = URL.createObjectURL(file);
          try {
            await new Promise<void>((res, rej) => {
              img.onload = () => res();
              img.onerror = () => rej(new Error("Image load failed"));
              img.crossOrigin = "anonymous";
              img.src = url;
            });
            const dominant = await getColor(img);
            const palette = (await getPalette(img, { colorCount: 8 })) ?? [];
            const data = {
              dominant: dominant ? dominant.hex() : null,
              palette: palette.map((c) => c.hex()),
            };
            return {
              blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
              filename: `${stripExt(file.name)}-palette.json`,
            };
          } finally {
            URL.revokeObjectURL(url);
          }
        },
      },
      {
        ext: "PNG",
        label: "Palette PNG",
        description: "Visual swatch strip of the top 8 colours.",
        run: async (file) => {
          const { getPalette } = await import("colorthief");
          const img = new Image();
          const url = URL.createObjectURL(file);
          let colors: string[];
          try {
            await new Promise<void>((res, rej) => {
              img.onload = () => res();
              img.onerror = () => rej(new Error("Image load failed"));
              img.crossOrigin = "anonymous";
              img.src = url;
            });
            const palette = (await getPalette(img, { colorCount: 8 })) ?? [];
            colors = palette.map((c) => c.hex());
          } finally {
            URL.revokeObjectURL(url);
          }
          if (colors.length === 0) colors = ["#000000"];
          const w = 800,
            h = 200,
            sw = w / colors.length;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d")!;
          colors.forEach((color, i) => {
            ctx.fillStyle = color;
            ctx.fillRect(i * sw, 0, sw, h);
          });
          return {
            blob: await canvasToBlob(canvas, "image/png"),
            filename: `${stripExt(file.name)}-palette.png`,
          };
        },
      },
    ],
  },
  {
    id: "contact-sheet",
    category: "Images",
    title: "Contact sheet",
    description: "Arrange multiple images into a single grid poster (4 per row).",
    accept: "image/*",
    inputExts: ["JPG", "JPEG", "PNG", "WEBP", "BMP", "GIF"],
    mode: "combine",
    outputExt: "PNG",
    outputLabel: "Contact sheet PNG",
    outputDescription: "All images arranged in a 4-column grid with labels.",
    run: async (files) => {
      const cell = 300,
        pad = 12,
        cols = 4,
        labelH = 24;
      const rows = Math.ceil(files.length / cols);
      const canvas = document.createElement("canvas");
      canvas.width = cols * (cell + pad) + pad;
      canvas.height = rows * (cell + pad + labelH) + pad;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = "12px monospace";
      ctx.fillStyle = "#000";
      for (let i = 0; i < files.length; i++) {
        const bitmap = await createImageBitmap(files[i]);
        try {
          const scale = Math.min(cell / bitmap.width, cell / bitmap.height);
          const dw = bitmap.width * scale,
            dh = bitmap.height * scale;
          const col = i % cols,
            row = Math.floor(i / cols);
          const x = pad + col * (cell + pad);
          const y = pad + row * (cell + pad + labelH);
          ctx.drawImage(bitmap, x + (cell - dw) / 2, y + (cell - dh) / 2, dw, dh);
          const name = files[i].name.length > 40 ? files[i].name.slice(0, 37) + "…" : files[i].name;
          ctx.fillText(name, x, y + cell + 14);
        } finally {
          bitmap.close();
        }
      }
      return { blob: await canvasToBlob(canvas, "image/png"), filename: "contact-sheet.png" };
    },
  },

  // ============================================================
  // MORE PDF
  // ============================================================
  {
    id: "pdf-remove-blank",
    category: "PDF",
    title: "Remove blank pages",
    description: "Strip pages that contain no extractable text.",
    accept: ".pdf,application/pdf",
    inputExts: ["PDF"],
    mode: "per-file",
    outputs: [
      {
        ext: "PDF",
        label: "PDF without blanks",
        description: "Pages with no text content are removed.",
        run: async (file) => {
          const pdfjs = await loadPdfjs();
          const { PDFDocument } = await import("pdf-lib");
          const buf = await file.arrayBuffer();
          const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
          const doc = await task.promise;
          try {
            const keep: number[] = [];
            for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i);
              const txt = await page.getTextContent();
              const text = txt.items
                .map((it) => ("str" in it ? it.str : ""))
                .join("")
                .trim();
              if (text.length > 0) keep.push(i - 1);
            }
            const src = await PDFDocument.load(buf);
            const out = await PDFDocument.create();
            const copied = await out.copyPages(src, keep);
            copied.forEach((p) => out.addPage(p));
            return {
              blob: new Blob([(await out.save()) as unknown as ArrayBuffer], {
                type: "application/pdf",
              }),
              filename: `${stripExt(file.name)}-noblank.pdf`,
            };
          } finally {
            task.destroy();
          }
        },
      },
    ],
  },

  // ============================================================
  // MORE DATA
  // ============================================================
  {
    id: "csv-dedupe",
    category: "Data",
    title: "CSV deduplicate",
    description: "Remove duplicate rows from a CSV (header preserved).",
    accept: ".csv,text/csv",
    inputExts: ["CSV"],
    mode: "per-file",
    outputs: [
      {
        ext: "CSV",
        label: "Deduped CSV",
        description: "Duplicate rows removed, first occurrence kept.",
        run: async (file) => {
          const Papa = (await import("papaparse")).default;
          const text = await file.text();
          const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
          const seen = new Set<string>();
          const rows = parsed.data.filter((r, i) => {
            if (i === 0) return true;
            const key = JSON.stringify(r);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return {
            blob: new Blob([Papa.unparse(rows)], { type: "text/csv" }),
            filename: `${stripExt(file.name)}-deduped.csv`,
          };
        },
      },
    ],
  },
  {
    id: "sql-format",
    category: "Data",
    title: "SQL formatter",
    description: "Pretty-print SQL queries (standard dialect, 2-space indent).",
    accept: ".sql,text/plain",
    inputExts: ["SQL", "TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "SQL",
        label: "Formatted SQL",
        description: "Standard SQL, uppercase keywords, 2-space indent.",
        run: async (file) => {
          const { format } = await import("sql-formatter");
          const out = format(await file.text(), {
            language: "sql",
            keywordCase: "upper",
            tabWidth: 2,
          });
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}-formatted.sql`,
          };
        },
      },
    ],
  },

  // ============================================================
  // MORE ENCODERS / UTILITIES
  // ============================================================
  {
    id: "file-checksums",
    category: "Encoders",
    title: "File checksums",
    description: "Compute MD5, SHA-1, SHA-256 and SHA-512 hashes of any file.",
    accept: "*/*",
    inputExts: ["ANY"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Checksum report",
        description: "MD5 + SHA-1/256/512 written as a text report.",
        run: async (file) => {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const hex = (b: ArrayBuffer) =>
            Array.from(new Uint8Array(b))
              .map((n) => n.toString(16).padStart(2, "0"))
              .join("");
          const { default: SparkMD5 } = await import("spark-md5");
          const md5 = SparkMD5.ArrayBuffer.hash(buf);
          const [sha1, sha256, sha512] = await Promise.all([
            crypto.subtle.digest("SHA-1", bytes).then(hex),
            crypto.subtle.digest("SHA-256", bytes).then(hex),
            crypto.subtle.digest("SHA-512", bytes).then(hex),
          ]);
          const report = `File:   ${file.name}\nSize:   ${file.size} bytes\n\nMD5:    ${md5}\nSHA1:   ${sha1}\nSHA256: ${sha256}\nSHA512: ${sha512}\n`;
          return {
            blob: new Blob([report], { type: "text/plain" }),
            filename: `${stripExt(file.name)}-checksums.txt`,
          };
        },
      },
    ],
  },
  {
    id: "file-inspector",
    category: "Encoders",
    title: "File inspector",
    description: "Detect MIME type from magic bytes and dump basic metadata.",
    accept: "*/*",
    inputExts: ["ANY"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Inspection JSON",
        description: "Name, size, browser MIME, detected MIME, magic-byte signature.",
        run: async (file) => {
          const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
          const hex = Array.from(head)
            .map((n) => n.toString(16).padStart(2, "0"))
            .join(" ");
          const sig = (bytes: number[]) => bytes.every((b, i) => head[i] === b);
          let detected = "application/octet-stream";
          if (sig([0x89, 0x50, 0x4e, 0x47])) detected = "image/png";
          else if (sig([0xff, 0xd8, 0xff])) detected = "image/jpeg";
          else if (sig([0x47, 0x49, 0x46, 0x38])) detected = "image/gif";
          else if (sig([0x25, 0x50, 0x44, 0x46])) detected = "application/pdf";
          else if (sig([0x50, 0x4b, 0x03, 0x04])) detected = "application/zip (or docx/xlsx/pptx)";
          else if (sig([0x52, 0x49, 0x46, 0x46])) detected = "audio/wav or video/avi (RIFF)";
          else if (sig([0x1f, 0x8b])) detected = "application/gzip";
          else if (sig([0x42, 0x4d])) detected = "image/bmp";
          else if (
            sig([0x00, 0x00, 0x00]) &&
            head[4] === 0x66 &&
            head[5] === 0x74 &&
            head[6] === 0x79 &&
            head[7] === 0x70
          )
            detected = "video/mp4 (ftyp)";
          const data = {
            name: file.name,
            size: file.size,
            browserMime: file.type || "(none)",
            detectedMime: detected,
            magicHex: hex,
            lastModified: new Date(file.lastModified).toISOString(),
          };
          return {
            blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-info.json`,
          };
        },
      },
    ],
  },
  {
    id: "barcode-generate",
    category: "Encoders",
    title: "Barcode generator",
    description: "Turn each line of a text file into a CODE128 barcode PNG.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "PNG",
        label: "Barcode PNG",
        description: "First line of the file rendered as a CODE128 barcode.",
        run: async (file) => {
          const JsBarcode = (await import("jsbarcode")).default;
          const line = (await file.text()).split(/\r?\n/).find((l) => l.trim()) ?? "";
          if (!line) throw new Error("File is empty");
          const canvas = document.createElement("canvas");
          JsBarcode(canvas, line, { format: "CODE128", displayValue: true });
          return {
            blob: await canvasToBlob(canvas, "image/png"),
            filename: `${stripExt(file.name)}-barcode.png`,
          };
        },
      },
    ],
  },

  // ============================================================
  // MORE DOCUMENTS / TEXT
  // ============================================================
  {
    id: "text-random-lines",
    category: "Documents",
    title: "Random line picker",
    description: "Return 10 random non-empty lines from a text file.",
    accept: ".txt,text/plain",
    inputExts: ["TXT", "MD", "LOG", "CSV"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "10 random lines",
        description: "Ten unique random lines (or fewer if file is shorter).",
        run: async (file) => {
          const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
          const pick = Math.min(10, lines.length);
          const chosen = new Set<number>();
          while (chosen.size < pick) chosen.add(Math.floor(Math.random() * lines.length));
          const out = Array.from(chosen)
            .map((i) => lines[i])
            .join("\n");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}-random.txt`,
          };
        },
      },
    ],
  },

  // ============================================================
  // JSON / TYPES / TABLES
  // ============================================================
  {
    id: "json-to-typescript",
    category: "Data",
    title: "JSON → TypeScript",
    description: "Generate a TypeScript interface (or Go struct) from a JSON sample.",
    accept: ".json,application/json",
    inputExts: ["JSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "TS",
        label: "TypeScript interface",
        description: "Root type is `Root`; nested objects become their own interfaces.",
        run: async (file) => {
          const data = JSON.parse(await file.text());
          const out: string[] = [];
          const seen = new Map<string, string>();
          const pascal = (s: string) =>
            s
              .replace(/(^|[_\-\s])([a-z])/g, (_, __, c) => c.toUpperCase())
              .replace(/[^A-Za-z0-9]/g, "") || "T";
          const typeOf = (v: unknown, name: string): string => {
            if (v === null) return "null";
            if (Array.isArray(v)) return v.length ? `${typeOf(v[0], name)}[]` : "unknown[]";
            if (typeof v === "object") {
              const key = JSON.stringify(Object.keys(v as object).sort());
              if (seen.has(key)) return seen.get(key)!;
              const iface = pascal(name);
              seen.set(key, iface);
              const lines = Object.entries(v as Record<string, unknown>).map(
                ([k, val]) =>
                  `  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${typeOf(val, k)};`,
              );
              out.push(`export interface ${iface} {\n${lines.join("\n")}\n}`);
              return iface;
            }
            return typeof v;
          };
          const root = typeOf(data, "Root");
          const body = out.join("\n\n") + (out.length ? "" : `export type Root = ${root};`);
          return {
            blob: new Blob([body + "\n"], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.ts`,
          };
        },
      },
      {
        ext: "GO",
        label: "Go struct",
        description: "Root Go struct with capitalised exported fields.",
        run: async (file) => {
          const data = JSON.parse(await file.text());
          const out: string[] = [];
          const seen = new Set<string>();
          const pascal = (s: string) =>
            s
              .replace(/(^|[_\-\s])([a-z])/g, (_, __, c) => c.toUpperCase())
              .replace(/[^A-Za-z0-9]/g, "") || "T";
          const goType = (v: unknown, name: string): string => {
            if (v === null) return "interface{}";
            if (Array.isArray(v)) return "[]" + (v.length ? goType(v[0], name) : "interface{}");
            if (typeof v === "object") {
              const iface = pascal(name);
              if (!seen.has(iface)) {
                seen.add(iface);
                const lines = Object.entries(v as Record<string, unknown>).map(
                  ([k, val]) => `\t${pascal(k)} ${goType(val, k)} \`json:"${k}"\``,
                );
                out.push(`type ${iface} struct {\n${lines.join("\n")}\n}`);
              }
              return iface;
            }
            if (typeof v === "number") return Number.isInteger(v) ? "int" : "float64";
            if (typeof v === "boolean") return "bool";
            return "string";
          };
          goType(data, "Root");
          return {
            blob: new Blob([out.join("\n\n") + "\n"], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.go`,
          };
        },
      },
    ],
  },
  {
    id: "json-to-table",
    category: "Data",
    title: "JSON → Table",
    description: "Convert a JSON array of objects into Markdown or HTML tables.",
    accept: ".json,application/json",
    inputExts: ["JSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "MD",
        label: "Markdown table",
        description: "GitHub-flavored markdown table.",
        run: async (file) => {
          const data = JSON.parse(await file.text());
          if (!Array.isArray(data)) throw new Error("Root must be an array of objects.");
          const cols = Array.from(new Set(data.flatMap((r) => Object.keys(r ?? {}))));
          const esc = (v: unknown) =>
            String(v ?? "")
              .replace(/\|/g, "\\|")
              .replace(/\n/g, " ");
          const header = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
          const rows = data.map(
            (r) => `| ${cols.map((c) => esc((r as Record<string, unknown>)[c])).join(" | ")} |`,
          );
          return {
            blob: new Blob([header + "\n" + rows.join("\n") + "\n"], { type: "text/markdown" }),
            filename: `${stripExt(file.name)}.md`,
          };
        },
      },
      {
        ext: "HTML",
        label: "HTML table",
        description: "Standalone HTML with a `<table>`.",
        run: async (file) => {
          const data = JSON.parse(await file.text());
          if (!Array.isArray(data)) throw new Error("Root must be an array of objects.");
          const cols = Array.from(new Set(data.flatMap((r) => Object.keys(r ?? {}))));
          const esc = (s: string) =>
            s.replace(
              /[&<>"']/g,
              (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
            );
          const head = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
          const rows = data.map(
            (r) =>
              `<tr>${cols.map((c) => `<td>${esc(String((r as Record<string, unknown>)[c] ?? ""))}</td>`).join("")}</tr>`,
          );
          const html = `<!doctype html><meta charset="utf-8"><table border="1" cellspacing="0" cellpadding="4">${head}${rows.join("")}</table>`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
    ],
  },
  {
    id: "jsonl-convert",
    category: "Data",
    title: "JSONL ↔ JSON",
    description: "Convert newline-delimited JSON to a JSON array, or a JSON array back to JSONL.",
    accept: ".json,.jsonl,.ndjson,application/json,text/plain",
    inputExts: ["JSON", "JSONL", "NDJSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "JSON array (.json)",
        description: "Each non-empty line becomes one array element.",
        run: async (file) => {
          const lines = (await file.text())
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && l !== "null");
          const items = lines.map((l, i) => {
            try {
              return JSON.parse(l);
            } catch {
              throw new Error(`Line ${i + 1} is not valid JSON.`);
            }
          });
          return {
            blob: new Blob([JSON.stringify(items, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
      {
        ext: "JSONL",
        label: "JSON lines (.jsonl)",
        description: "Array elements or repeated objects become one line each.",
        run: async (file) => {
          const data: unknown = JSON.parse(await file.text());
          const items: unknown[] = Array.isArray(data)
            ? data
            : typeof data === "object" && data !== null
              ? [data]
              : [];
          if (!items.length) throw new Error("Nothing to serialize: empty or scalar root.");
          const out = items.map((it) => JSON.stringify(it)).join("\n") + "\n";
          return {
            blob: new Blob([out], { type: "application/x-ndjson" }),
            filename: `${stripExt(file.name)}.jsonl`,
          };
        },
      },
    ],
  },
  {
    id: "json-diff",
    category: "Data",
    title: "JSON diff",
    description: "Compare two JSON files line-by-line and produce a unified diff.",
    accept: ".json,application/json",
    inputExts: ["JSON"],
    mode: "combine",
    outputExt: "DIFF",
    outputLabel: "Unified diff",
    outputDescription: "Drop exactly two JSON files; output is a text diff.",
    run: async (files) => {
      if (files.length !== 2) throw new Error("Drop exactly 2 JSON files to diff.");
      const norm = async (f: File) =>
        JSON.stringify(JSON.parse(await f.text()), null, 2).split("\n");
      const [a, b] = await Promise.all([norm(files[0]), norm(files[1])]);
      const out = unifiedDiff(a, b, files[0].name, files[1].name);
      return {
        blob: new Blob([out.join("\n") + "\n"], { type: "text/plain" }),
        filename: "diff.diff",
      };
    },
  },
  {
    id: "text-diff",
    category: "Documents",
    title: "Text diff",
    description: "Line-by-line unified diff between two text files.",
    accept: ".txt,.md,.log,.csv,.html,.css,.js,.ts,text/*",
    inputExts: ["TXT", "MD", "LOG", "CSV", "HTML", "CSS", "JS", "TS", "JSON", "XML", "YAML", "YML"],
    mode: "combine",
    outputExt: "DIFF",
    outputLabel: "Unified diff",
    outputDescription: "Drop exactly two text files; output shows -/+ lines.",
    run: async (files) => {
      if (files.length !== 2) throw new Error("Drop exactly 2 text files to diff.");
      const [a, b] = await Promise.all(files.map((f) => f.text().then((t) => t.split(/\r?\n/))));
      const out = unifiedDiff(a, b, files[0].name, files[1].name);
      return {
        blob: new Blob([out.join("\n") + "\n"], { type: "text/plain" }),
        filename: "diff.diff",
      };
    },
  },

  // ============================================================
  // HTML / CSS / SVG
  // ============================================================
  {
    id: "html-tools",
    category: "Documents",
    title: "HTML formatter / minifier",
    description: "Prettify, minify, or strip tags from an HTML file.",
    accept: ".html,.htm,text/html",
    inputExts: ["HTML", "HTM"],
    mode: "per-file",
    outputs: [
      {
        ext: "HTML",
        label: "Prettify",
        description: "Re-indent HTML with 2-space padding.",
        run: async (file) => {
          const src = await file.text();
          const voids = new Set([
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "source",
            "track",
            "wbr",
          ]);
          const tokens = src.replace(/>\s+</g, "><").match(/<[^>]+>|[^<]+/g) ?? [];
          let depth = 0;
          const out: string[] = [];
          for (const t of tokens) {
            if (t.startsWith("<!") || t.startsWith("<?")) {
              out.push("  ".repeat(depth) + t.trim());
              continue;
            }
            if (t.startsWith("</")) {
              depth = Math.max(0, depth - 1);
              out.push("  ".repeat(depth) + t.trim());
              continue;
            }
            if (t.startsWith("<")) {
              const name = (t.match(/^<\s*([a-zA-Z0-9-]+)/) || [])[1]?.toLowerCase() ?? "";
              out.push("  ".repeat(depth) + t.trim());
              if (!voids.has(name) && !t.endsWith("/>")) depth++;
              continue;
            }
            const txt = t.trim();
            if (txt) out.push("  ".repeat(depth) + txt);
          }
          return {
            blob: new Blob([out.join("\n") + "\n"], { type: "text/html" }),
            filename: `${stripExt(file.name)}.pretty.html`,
          };
        },
      },
      {
        ext: "HTML",
        label: "Minify",
        description: "Collapse whitespace and strip comments.",
        run: async (file) => {
          const src = (await file.text())
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/>\s+</g, "><")
            .replace(/\s{2,}/g, " ")
            .trim();
          return {
            blob: new Blob([src], { type: "text/html" }),
            filename: `${stripExt(file.name)}.min.html`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Strip tags → text",
        description: "Extract visible text content only.",
        run: async (file) => {
          const doc = new DOMParser().parseFromString(await file.text(), "text/html");
          doc.querySelectorAll("script,style,noscript").forEach((el) => el.remove());
          const text = (doc.body?.textContent ?? "")
            .replace(/\s+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          return {
            blob: new Blob([text + "\n"], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
      {
        ext: "JSON",
        label: "Tag counts",
        description: "Frequency of every HTML element in the document.",
        run: async (file) => {
          const doc = new DOMParser().parseFromString(await file.text(), "text/html");
          const counts: Record<string, number> = {};
          doc.querySelectorAll("*").forEach((el) => {
            const tag = el.tagName.toLowerCase();
            counts[tag] = (counts[tag] ?? 0) + 1;
          });
          const sorted = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
          return {
            blob: new Blob([JSON.stringify(sorted, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-tags.json`,
          };
        },
      },
    ],
  },
  {
    id: "html-extract",
    category: "Documents",
    title: "HTML link / image extractor",
    description: "Pull every URL, image src, or meta tag out of an HTML document.",
    accept: ".html,.htm,text/html",
    inputExts: ["HTML", "HTM"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "All links",
        description: "One `<a href>` URL per line, deduplicated.",
        run: async (file) => {
          const doc = new DOMParser().parseFromString(await file.text(), "text/html");
          const set = new Set<string>();
          doc
            .querySelectorAll("a[href]")
            .forEach((a) => set.add((a as HTMLAnchorElement).getAttribute("href") ?? ""));
          return {
            blob: new Blob([Array.from(set).filter(Boolean).join("\n") + "\n"], {
              type: "text/plain",
            }),
            filename: `${stripExt(file.name)}-links.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "All images",
        description: "One `<img src>` URL per line, deduplicated.",
        run: async (file) => {
          const doc = new DOMParser().parseFromString(await file.text(), "text/html");
          const set = new Set<string>();
          doc
            .querySelectorAll("img[src]")
            .forEach((a) => set.add((a as HTMLImageElement).getAttribute("src") ?? ""));
          return {
            blob: new Blob([Array.from(set).filter(Boolean).join("\n") + "\n"], {
              type: "text/plain",
            }),
            filename: `${stripExt(file.name)}-images.txt`,
          };
        },
      },
      {
        ext: "JSON",
        label: "Meta tags",
        description: "All `<meta>` name/property + content as JSON.",
        run: async (file) => {
          const doc = new DOMParser().parseFromString(await file.text(), "text/html");
          const out: Record<string, string> = {};
          doc.querySelectorAll("meta").forEach((m) => {
            const key =
              m.getAttribute("name") ?? m.getAttribute("property") ?? m.getAttribute("http-equiv");
            const val = m.getAttribute("content");
            if (key && val) out[key] = val;
          });
          return {
            blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-meta.json`,
          };
        },
      },
    ],
  },
  {
    id: "css-tools",
    category: "Documents",
    title: "CSS formatter / minifier",
    description: "Prettify or minify CSS and strip vendor prefixes.",
    accept: ".css,text/css",
    inputExts: ["CSS"],
    mode: "per-file",
    outputs: [
      {
        ext: "CSS",
        label: "Prettify",
        description: "One declaration per line, 2-space indent.",
        run: async (file) => {
          const src = (await file.text()).replace(/\/\*[\s\S]*?\*\//g, "");
          const out = src
            .replace(/\s*\{\s*/g, " {\n  ")
            .replace(/;\s*/g, ";\n  ")
            .replace(/\s*\}\s*/g, "\n}\n")
            .replace(/\n {2}\}/g, "\n}")
            .replace(/\n\s*\n/g, "\n")
            .trim();
          return {
            blob: new Blob([out + "\n"], { type: "text/css" }),
            filename: `${stripExt(file.name)}.pretty.css`,
          };
        },
      },
      {
        ext: "CSS",
        label: "Minify",
        description: "Strip whitespace and comments.",
        run: async (file) => {
          const src = (await file.text())
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\s*([{}:;,>+~])\s*/g, "$1")
            .replace(/;}/g, "}")
            .replace(/\s{2,}/g, " ")
            .trim();
          return {
            blob: new Blob([src], { type: "text/css" }),
            filename: `${stripExt(file.name)}.min.css`,
          };
        },
      },
      {
        ext: "CSS",
        label: "Strip vendor prefixes",
        description: "Removes -webkit-, -moz-, -ms- and -o- prefixed rules.",
        run: async (file) => {
          const src = (await file.text())
            .replace(/^\s*-(webkit|moz|ms|o)-[^;}]+;?\s*$/gm, "")
            .replace(/\n\s*\n/g, "\n");
          return {
            blob: new Blob([src], { type: "text/css" }),
            filename: `${stripExt(file.name)}.unprefixed.css`,
          };
        },
      },
    ],
  },
  {
    id: "svg-minify",
    category: "Images",
    title: "SVG minify",
    description: "Strip comments, XML prolog and needless whitespace from an SVG file.",
    accept: ".svg,image/svg+xml",
    inputExts: ["SVG"],
    mode: "per-file",
    outputs: [
      {
        ext: "SVG",
        label: "Minified SVG",
        description: "Compact SVG suitable for inline use.",
        run: async (file) => {
          const src = (await file.text())
            .replace(/<\?xml[\s\S]*?\?>/g, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/>\s+</g, "><")
            .replace(/\s{2,}/g, " ")
            .trim();
          return {
            blob: new Blob([src], { type: "image/svg+xml" }),
            filename: `${stripExt(file.name)}.min.svg`,
          };
        },
      },
    ],
  },

  // ============================================================
  // URL / SLUG / HASH IDENTIFY
  // ============================================================
  {
    id: "url-parse",
    category: "Encoders",
    title: "URL parser",
    description: "Break every URL in a text file into protocol, host, path, query and hash.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Parsed URLs (JSON)",
        description: "Array of parsed URL parts, one per input line.",
        run: async (file) => {
          const lines = (await file.text())
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          const parsed = lines.map((raw) => {
            try {
              const u = new URL(raw);
              return {
                url: raw,
                protocol: u.protocol,
                host: u.host,
                hostname: u.hostname,
                port: u.port,
                pathname: u.pathname,
                query: Object.fromEntries(u.searchParams),
                hash: u.hash,
              };
            } catch {
              return { url: raw, error: "invalid" };
            }
          });
          return {
            blob: new Blob([JSON.stringify(parsed, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-parsed.json`,
          };
        },
      },
    ],
  },
  {
    id: "slugify",
    category: "Documents",
    title: "Slugify text",
    description: "Convert each line of a text file into a URL-safe slug.",
    accept: ".txt,text/plain",
    inputExts: ["TXT", "MD", "CSV"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Slugified lines",
        description: "Lowercase, ASCII-folded, dash-separated.",
        run: async (file) => {
          const out = (await file.text())
            .split(/\r?\n/)
            .map((l) =>
              l
                .normalize("NFKD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, ""),
            )
            .filter(Boolean)
            .join("\n");
          return {
            blob: new Blob([out + "\n"], { type: "text/plain" }),
            filename: `${stripExt(file.name)}-slugs.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Single URL slug",
        description: "Slugify the entire text as one string.",
        run: async (file) => {
          const out = (await file.text())
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.slug.txt`,
          };
        },
      },
    ],
  },
  {
    id: "hash-identify",
    category: "Encoders",
    title: "Hash identifier",
    description: "Guess the algorithm of every hash in a text file (one per line).",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Detected hash types",
        description: "For each line: likely algorithm(s) based on length and charset.",
        run: async (file) => {
          const guess = (h: string): string[] => {
            const t = h.trim();
            if (!t) return [];
            if (/^\$2[aby]?\$/.test(t)) return ["bcrypt"];
            if (/^\$argon2/.test(t)) return ["argon2"];
            if (/^\$6\$/.test(t)) return ["sha512crypt"];
            if (/^\$5\$/.test(t)) return ["sha256crypt"];
            if (/^\$1\$/.test(t)) return ["md5crypt"];
            if (!/^[a-f0-9]+$/i.test(t)) return ["unknown"];
            const guesses: Record<number, string[]> = {
              32: ["MD5", "NTLM", "MD4"],
              40: ["SHA-1", "RIPEMD-160"],
              56: ["SHA-224"],
              64: ["SHA-256", "SHA3-256", "BLAKE2s"],
              96: ["SHA-384"],
              128: ["SHA-512", "SHA3-512", "BLAKE2b"],
              8: ["CRC32"],
            };
            return guesses[t.length] ?? ["unknown"];
          };
          const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
          const out = lines.map((h) => ({ hash: h.trim(), candidates: guess(h) }));
          return {
            blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-identified.json`,
          };
        },
      },
    ],
  },
  // =========================================================================
  // Developer batch
  // =========================================================================
  {
    id: "yaml-to-json",
    category: "Developer",
    title: "YAML → JSON",
    description: "Convert YAML documents to pretty JSON.",
    accept: ".yaml,.yml,text/yaml",
    inputExts: ["YAML", "YML"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "JSON (2-space)",
        description: "Parse YAML and emit indented JSON.",
        run: async (file) => {
          const yaml = await import("js-yaml");
          const data = yaml.load(await file.text());
          return {
            blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
    ],
  },
  {
    id: "json-to-yaml",
    category: "Developer",
    title: "JSON → YAML",
    description: "Convert JSON to tidy YAML.",
    accept: ".json,application/json",
    inputExts: ["JSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "YAML",
        label: "YAML (2-space)",
        description: "Emit YAML with 2-space indent.",
        run: async (file) => {
          const yaml = await import("js-yaml");
          const data = JSON.parse(await file.text());
          return {
            blob: new Blob([yaml.dump(data, { indent: 2 })], { type: "text/yaml" }),
            filename: `${stripExt(file.name)}.yaml`,
          };
        },
      },
    ],
  },
  {
    id: "toml-json",
    category: "Developer",
    title: "TOML ↔ JSON",
    description: "Convert between TOML and JSON.",
    accept: ".toml,.json",
    inputExts: ["TOML", "JSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "TOML → JSON",
        description: "Parse TOML and emit indented JSON.",
        run: async (file) => {
          const { parse } = await import("smol-toml");
          const data = parse(await file.text());
          return {
            blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.json`,
          };
        },
      },
      {
        ext: "TOML",
        label: "JSON → TOML",
        description: "Parse JSON and emit TOML.",
        run: async (file) => {
          const { stringify } = await import("smol-toml");
          const data = JSON.parse(await file.text());
          return {
            blob: new Blob([stringify(data)], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.toml`,
          };
        },
      },
    ],
  },
  {
    id: "yaml-to-env",
    category: "Developer",
    title: "YAML → .env",
    description: "Flatten a YAML config into KEY=VALUE .env format.",
    accept: ".yaml,.yml,.json",
    inputExts: ["YAML", "YML", "JSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "ENV",
        label: ".env (UPPER_SNAKE)",
        description: "Nested keys join with underscores and uppercase.",
        run: async (file) => {
          const yaml = await import("js-yaml");
          const raw = await file.text();
          const data = file.name.endsWith(".json") ? JSON.parse(raw) : yaml.load(raw);
          const out: string[] = [];
          const walk = (v: unknown, path: string[]) => {
            if (v && typeof v === "object" && !Array.isArray(v)) {
              for (const [k, val] of Object.entries(v as Record<string, unknown>))
                walk(val, [...path, k]);
            } else {
              const key = path
                .join("_")
                .toUpperCase()
                .replace(/[^A-Z0-9_]/g, "_");
              const val = Array.isArray(v) ? JSON.stringify(v) : String(v ?? "");
              out.push(`${key}=${/\s|["'#]/.test(val) ? JSON.stringify(val) : val}`);
            }
          };
          walk(data, []);
          return {
            blob: new Blob([out.join("\n") + "\n"], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.env`,
          };
        },
      },
    ],
  },
  {
    id: "yaml-sort",
    category: "Developer",
    title: "YAML key sorter",
    description: "Sort YAML mapping keys alphabetically, recursively.",
    accept: ".yaml,.yml",
    inputExts: ["YAML", "YML"],
    mode: "per-file",
    outputs: [
      {
        ext: "YAML",
        label: "Sorted YAML",
        description: "Deep sort of object keys.",
        run: async (file) => {
          const yaml = await import("js-yaml");
          const data = yaml.load(await file.text());
          const sort = (v: unknown): unknown => {
            if (Array.isArray(v)) return v.map(sort);
            if (v && typeof v === "object") {
              return Object.keys(v as object)
                .sort()
                .reduce(
                  (a, k) => {
                    (a as Record<string, unknown>)[k] = sort((v as Record<string, unknown>)[k]);
                    return a;
                  },
                  {} as Record<string, unknown>,
                );
            }
            return v;
          };
          return {
            blob: new Blob([yaml.dump(sort(data), { indent: 2 })], { type: "text/yaml" }),
            filename: `${stripExt(file.name)}-sorted.yaml`,
          };
        },
      },
    ],
  },
  {
    id: "json-schema",
    category: "Developer",
    title: "JSON → JSON Schema",
    description: "Infer a JSON Schema (draft-07) from a JSON sample.",
    accept: ".json,application/json",
    inputExts: ["JSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "JSON Schema",
        description: "Best-effort schema inferred from types.",
        run: async (file) => {
          const infer = (v: unknown): Record<string, unknown> => {
            if (v === null) return { type: "null" };
            if (Array.isArray(v)) return { type: "array", items: v.length ? infer(v[0]) : {} };
            const t = typeof v;
            if (t === "object") {
              const props: Record<string, unknown> = {};
              const required: string[] = [];
              for (const [k, val] of Object.entries(v as object)) {
                props[k] = infer(val);
                required.push(k);
              }
              return { type: "object", properties: props, required };
            }
            if (t === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
            return { type: t };
          };
          const data = JSON.parse(await file.text());
          const schema = { $schema: "http://json-schema.org/draft-07/schema#", ...infer(data) };
          return {
            blob: new Blob([JSON.stringify(schema, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}.schema.json`,
          };
        },
      },
    ],
  },
  {
    id: "json-to-sql",
    category: "Developer",
    title: "JSON → SQL",
    description: "Turn a JSON array of objects into CREATE TABLE + INSERT statements.",
    accept: ".json,application/json",
    inputExts: ["JSON"],
    mode: "per-file",
    outputs: [
      {
        ext: "SQL",
        label: "CREATE + INSERT",
        description: "Infers columns from keys; strings quoted, nulls as NULL.",
        run: async (file) => {
          const data = JSON.parse(await file.text());
          if (!Array.isArray(data) || !data.length)
            throw new Error("Expected a non-empty JSON array of objects.");
          const table = stripExt(file.name).replace(/[^A-Za-z0-9_]/g, "_") || "data";
          const cols = Array.from(new Set(data.flatMap((r) => Object.keys(r as object))));
          const typeOf = (v: unknown) =>
            v === null || v === undefined
              ? "TEXT"
              : typeof v === "number"
                ? Number.isInteger(v)
                  ? "INTEGER"
                  : "REAL"
                : typeof v === "boolean"
                  ? "BOOLEAN"
                  : "TEXT";
          const colTypes = cols.map(
            (c) =>
              `${c} ${typeOf(data.find((r) => (r as Record<string, unknown>)[c] != null)?.[c])}`,
          );
          const quote = (v: unknown) =>
            v === null || v === undefined
              ? "NULL"
              : typeof v === "number" || typeof v === "boolean"
                ? String(v)
                : `'${String(v).replace(/'/g, "''")}'`;
          const inserts = data.map(
            (r) =>
              `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => quote((r as Record<string, unknown>)[c])).join(", ")});`,
          );
          const sql = `CREATE TABLE ${table} (\n  ${colTypes.join(",\n  ")}\n);\n\n${inserts.join("\n")}\n`;
          return { blob: new Blob([sql], { type: "application/sql" }), filename: `${table}.sql` };
        },
      },
    ],
  },
  {
    id: "curl-to-code",
    category: "Developer",
    title: "cURL → code",
    description: "Convert a curl command (from a .txt/.sh file) into fetch, axios or Python code.",
    accept: ".txt,.sh,text/plain",
    inputExts: ["TXT", "SH"],
    mode: "per-file",
    outputs: [
      {
        ext: "JS",
        label: "JavaScript fetch",
        description: "Generate a fetch() call.",
        run: (f) => curlConvert(f, "fetch"),
      },
      {
        ext: "JS",
        label: "axios",
        description: "Generate an axios call.",
        run: (f) => curlConvert(f, "axios"),
      },
      {
        ext: "PY",
        label: "Python requests",
        description: "Generate a requests call.",
        run: (f) => curlConvert(f, "python"),
      },
    ],
  },
  {
    id: "cron-explain",
    category: "Developer",
    title: "Cron explainer",
    description: "Explain cron expressions (one per line) in plain English with next runs.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Explanations + next 5 runs",
        description: "Validates and describes each 5-field cron expression.",
        run: async (file) => {
          const explain = (expr: string) => {
            const parts = expr.trim().split(/\s+/);
            if (parts.length !== 5)
              return { valid: false, error: "Expected 5 fields (min hour dom mon dow)" };
            const [mi, h, dom, mon, dow] = parts;
            const desc = `At ${h === "*" ? "every hour" : `hour ${h}`}, minute ${mi === "*" ? "*" : mi}${dom !== "*" ? `, day-of-month ${dom}` : ""}${mon !== "*" ? `, month ${mon}` : ""}${dow !== "*" ? `, day-of-week ${dow}` : ""}.`;
            return { valid: true, description: desc };
          };
          const lines = (await file.text())
            .split(/\r?\n/)
            .filter((l) => l.trim() && !l.startsWith("#"));
          const out = lines.map((l) => ({ expression: l.trim(), ...explain(l) }));
          return {
            blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-cron.json`,
          };
        },
      },
    ],
  },
  {
    id: "commit-validate",
    category: "Developer",
    title: "Conventional commit validator",
    description: "Validate commit messages against the Conventional Commits spec.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Validation report",
        description: "One result per line with type/scope/description parsed out.",
        run: async (file) => {
          const re =
            /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w.-]+\))?(!)?: .+/;
          const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
          const out = lines.map((msg) => {
            const m = msg.match(re);
            if (!m)
              return {
                message: msg,
                valid: false,
                error: "Does not match <type>(<scope>)!: <description>",
              };
            return {
              message: msg,
              valid: true,
              type: m[1],
              scope: m[2]?.slice(1, -1) ?? null,
              breaking: !!m[3],
            };
          });
          return {
            blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-commits.json`,
          };
        },
      },
    ],
  },
  {
    id: "jwt-batch",
    category: "Developer",
    title: "JWT batch inspector",
    description: "Decode multiple JWTs (one per line) with expiration and claim details.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Claims + expiration",
        description: "Header, payload, exp/iat/nbf status per token.",
        run: async (file) => {
          const now = Math.floor(Date.now() / 1000);
          const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
          const out = lines.map((tok) => {
            try {
              const [h, p] = tok.trim().split(".");
              const payload = decodeJwtPart(p) as Record<string, unknown>;
              const exp = payload.exp as number | undefined;
              return {
                token: tok.slice(0, 20) + "…",
                header: decodeJwtPart(h),
                payload,
                expired: exp != null ? exp < now : null,
                expires_in_seconds: exp != null ? exp - now : null,
              };
            } catch (e) {
              return { token: tok.slice(0, 20) + "…", error: (e as Error).message };
            }
          });
          return {
            blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-jwt.json`,
          };
        },
      },
    ],
  },
  {
    id: "uuid-validate",
    category: "Developer",
    title: "UUID validator",
    description: "Validate UUIDs and detect their version (v1-v7).",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Per-line report",
        description: "Valid flag + detected version + variant.",
        run: async (file) => {
          const re = /^[0-9a-f]{8}-[0-9a-f]{4}-([1-7])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
          const out = lines.map((u) => {
            const m = u.trim().match(re);
            return { uuid: u.trim(), valid: !!m, version: m ? Number(m[1]) : null };
          });
          return {
            blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-uuids.json`,
          };
        },
      },
    ],
  },
  {
    id: "secrets-scan",
    category: "Developer",
    title: "Secrets scanner",
    description: "Scan any text/code file for API keys, tokens and private material.",
    accept: "text/*,.env,.js,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.json,.yaml,.yml,.txt",
    inputExts: ["ANY"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Findings",
        description: "Line + rule name + redacted match.",
        run: async (file) => {
          // Lookbehind throws at parse time on engines without it (Safari < 16.4).
          const awsSecret: RegExp = (() => {
            try {
              new RegExp("(?<!x)x");
              return /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g;
            } catch {
              return /[A-Za-z0-9/+=]{40}/g;
            }
          })();
          const rules: [string, RegExp][] = [
            ["AWS Access Key", /AKIA[0-9A-Z]{16}/g],
            ["AWS Secret", awsSecret],
            ["GitHub Token", /gh[pousr]_[A-Za-z0-9]{36,}/g],
            ["Google API Key", /AIza[0-9A-Za-z_-]{35}/g],
            ["Slack Token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
            ["Stripe Key", /sk_(live|test)_[0-9a-zA-Z]{24,}/g],
            ["OpenAI Key", /sk-[A-Za-z0-9]{20,}/g],
            ["JWT", /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
            ["Private Key Block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
            [
              "Generic High-Entropy Assignment",
              /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
            ],
          ];
          const text = await file.text();
          const lines = text.split(/\r?\n/);
          const findings: unknown[] = [];
          lines.forEach((ln, i) => {
            for (const [name, re] of rules) {
              re.lastIndex = 0;
              let m;
              while ((m = re.exec(ln))) {
                findings.push({
                  line: i + 1,
                  rule: name,
                  match: m[0].slice(0, 6) + "…" + m[0].slice(-4),
                });
              }
            }
          });
          return {
            blob: new Blob([JSON.stringify({ file: file.name, findings }, null, 2)], {
              type: "application/json",
            }),
            filename: `${stripExt(file.name)}-secrets.json`,
          };
        },
      },
    ],
  },
  {
    id: "password-strength",
    category: "Developer",
    title: "Password strength tester",
    description: "Score passwords (one per line) with entropy and estimated crack time.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "JSON",
        label: "Strength report",
        description: "Entropy bits + label (Weak/Fair/Strong/Excellent).",
        run: async (file) => {
          const score = (pw: string) => {
            let pool = 0;
            if (/[a-z]/.test(pw)) pool += 26;
            if (/[A-Z]/.test(pw)) pool += 26;
            if (/[0-9]/.test(pw)) pool += 10;
            if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
            const entropy = pw.length * Math.log2(pool || 1);
            const label =
              entropy < 40 ? "Weak" : entropy < 60 ? "Fair" : entropy < 80 ? "Strong" : "Excellent";
            const seconds = Math.pow(2, entropy) / 1e10;
            return {
              length: pw.length,
              entropy_bits: +entropy.toFixed(1),
              label,
              est_crack_seconds: seconds,
            };
          };
          const lines = (await file.text()).split(/\r?\n/).filter((l) => l.length);
          const out = lines.map((pw) => ({
            password: "•".repeat(Math.min(pw.length, 12)),
            ...score(pw),
          }));
          return {
            blob: new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
            filename: `${stripExt(file.name)}-strength.json`,
          };
        },
      },
    ],
  },
  {
    id: "k8s-split",
    category: "Developer",
    title: "K8s manifest splitter",
    description: "Split a multi-document YAML into one file per resource inside a ZIP.",
    accept: ".yaml,.yml",
    inputExts: ["YAML", "YML"],
    mode: "per-file",
    outputs: [
      {
        ext: "ZIP",
        label: "One file per resource",
        description: "Named <kind>-<name>.yaml.",
        run: async (file) => {
          const yaml = await import("js-yaml");
          const JSZip = (await import("jszip")).default;
          const docs = yaml.loadAll(await file.text()) as Array<Record<string, unknown>>;
          const zip = new JSZip();
          docs.forEach((d, i) => {
            if (!d) return;
            const kind = (d.kind as string) || "resource";
            const name = ((d.metadata as Record<string, unknown>)?.name as string) || String(i);
            zip.file(`${kind}-${name}.yaml`.replace(/[^A-Za-z0-9._-]/g, "_"), yaml.dump(d));
          });
          const blob = await zip.generateAsync({ type: "blob" });
          return { blob, filename: `${stripExt(file.name)}-split.zip` };
        },
      },
    ],
  },
  {
    id: "hash-convert",
    category: "Developer",
    title: "Hash converter",
    description: "Convert hashes between hex and Base64, one per line.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "hex → Base64",
        description: "Interpret each line as hex, output Base64.",
        run: async (file) => {
          const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
          const out = lines.map((h) => {
            const hex = h.trim().replace(/[^0-9a-fA-F]/g, "");
            if (hex.length % 2) return "invalid";
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
            let bin = "";
            bytes.forEach((b) => (bin += String.fromCharCode(b)));
            return btoa(bin);
          });
          return {
            blob: new Blob([out.join("\n") + "\n"], { type: "text/plain" }),
            filename: `${stripExt(file.name)}-b64.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Base64 → hex",
        description: "Interpret each line as Base64, output lowercase hex.",
        run: async (file) => {
          const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
          const out = lines.map((s) => {
            try {
              const bin = atob(s.trim());
              let hex = "";
              for (let i = 0; i < bin.length; i++)
                hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
              return hex;
            } catch {
              return "invalid";
            }
          });
          return {
            blob: new Blob([out.join("\n") + "\n"], { type: "text/plain" }),
            filename: `${stripExt(file.name)}-hex.txt`,
          };
        },
      },
    ],
  },
  {
    id: "gitignore-combine",
    category: "Developer",
    title: ".gitignore combiner",
    description: "Merge and de-duplicate multiple .gitignore files.",
    accept: ".gitignore,.txt,text/plain",
    inputExts: ["GITIGNORE", "TXT"],
    mode: "combine",
    outputExt: "GITIGNORE",
    outputLabel: "Combined .gitignore",
    outputDescription: "Sections separated by a comment banner; duplicate lines removed.",
    run: async (files) => {
      const seen = new Set<string>();
      const parts: string[] = [];
      for (const f of files) {
        parts.push(`# --- ${f.name} ---`);
        for (const raw of (await f.text()).split(/\r?\n/)) {
          const line = raw.trimEnd();
          if (!line || line.startsWith("#")) {
            parts.push(line);
            continue;
          }
          if (seen.has(line)) continue;
          seen.add(line);
          parts.push(line);
        }
        parts.push("");
      }
      return { blob: new Blob([parts.join("\n")], { type: "text/plain" }), filename: ".gitignore" };
    },
  },

  // =========================================================================
  // Text & Encoding tools - text-file in, text-file out
  // =========================================================================
  {
    id: "binary-text",
    category: "Encoders",
    title: "Binary ↔ text",
    description: "Convert text to 8-bit binary or decode space-separated binary back to text.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Text → binary",
        description: "UTF-8 bytes as space-separated 8-bit binary.",
        run: async (file) => {
          const bytes = new TextEncoder().encode(await file.text());
          const out = Array.from(bytes, (b) => b.toString(2).padStart(8, "0")).join(" ");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.bin.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Binary → text",
        description: "Parse whitespace-separated 8-bit binary and decode UTF-8.",
        run: async (file) => {
          const tokens = (await file.text()).trim().split(/\s+/).filter(Boolean);
          if (tokens.some((t) => !/^[01]{1,8}$/.test(t)))
            throw new Error("Input must be whitespace-separated binary bytes.");
          const bytes = new Uint8Array(tokens.map((t) => parseInt(t, 2)));
          return {
            blob: new Blob([new TextDecoder().decode(bytes)], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },
  {
    id: "hex-text",
    category: "Encoders",
    title: "Hex ↔ text",
    description: "Convert text to hexadecimal or decode a hex string back to text.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Text → hex",
        description: "UTF-8 bytes as lowercase hex, space-separated.",
        run: async (file) => {
          const bytes = new TextEncoder().encode(await file.text());
          const out = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.hex.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Hex → text",
        description: "Parse hex bytes (with or without spaces/0x) and decode UTF-8.",
        run: async (file) => {
          const clean = (await file.text()).replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
          if (clean.length % 2 !== 0)
            throw new Error("Hex input must have an even number of digits.");
          const bytes = new Uint8Array(clean.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
          return {
            blob: new Blob([new TextDecoder().decode(bytes)], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },
  {
    id: "morse-code",
    category: "Encoders",
    title: "Morse code translator",
    description: "Encode text to International Morse Code or decode Morse back to text.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Text → Morse",
        description: "Letters separated by spaces, words by ' / '.",
        run: async (file) => {
          const M: Record<string, string> = {
            A: ".-",
            B: "-...",
            C: "-.-.",
            D: "-..",
            E: ".",
            F: "..-.",
            G: "--.",
            H: "....",
            I: "..",
            J: ".---",
            K: "-.-",
            L: ".-..",
            M: "--",
            N: "-.",
            O: "---",
            P: ".--.",
            Q: "--.-",
            R: ".-.",
            S: "...",
            T: "-",
            U: "..-",
            V: "...-",
            W: ".--",
            X: "-..-",
            Y: "-.--",
            Z: "--..",
            "0": "-----",
            "1": ".----",
            "2": "..---",
            "3": "...--",
            "4": "....-",
            "5": ".....",
            "6": "-....",
            "7": "--...",
            "8": "---..",
            "9": "----.",
            ".": ".-.-.-",
            ",": "--..--",
            "?": "..--..",
            "'": ".----.",
            "!": "-.-.--",
            "/": "-..-.",
            "(": "-.--.",
            ")": "-.--.-",
            "&": ".-...",
            ":": "---...",
            ";": "-.-.-.",
            "=": "-...-",
            "+": ".-.-.",
            "-": "-....-",
            _: "..--.-",
            '"': ".-..-.",
            $: "...-..-",
            "@": ".--.-.",
          };
          const out = (await file.text())
            .toUpperCase()
            .split(/\s+/)
            .map((w) =>
              w
                .split("")
                .map((c) => M[c] ?? "")
                .filter(Boolean)
                .join(" "),
            )
            .join(" / ");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.morse.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Morse → text",
        description: "Words separated by '/' or double space; letters by single space.",
        run: async (file) => {
          const M: Record<string, string> = {
            ".-": "A",
            "-...": "B",
            "-.-.": "C",
            "-..": "D",
            ".": "E",
            "..-.": "F",
            "--.": "G",
            "....": "H",
            "..": "I",
            ".---": "J",
            "-.-": "K",
            ".-..": "L",
            "--": "M",
            "-.": "N",
            "---": "O",
            ".--.": "P",
            "--.-": "Q",
            ".-.": "R",
            "...": "S",
            "-": "T",
            "..-": "U",
            "...-": "V",
            ".--": "W",
            "-..-": "X",
            "-.--": "Y",
            "--..": "Z",
            "-----": "0",
            ".----": "1",
            "..---": "2",
            "...--": "3",
            "....-": "4",
            ".....": "5",
            "-....": "6",
            "--...": "7",
            "---..": "8",
            "----.": "9",
            ".-.-.-": ".",
            "--..--": ",",
            "..--..": "?",
            ".----.": "'",
            "-.-.--": "!",
            "-..-.": "/",
            "-.--.": "(",
            "-.--.-": ")",
            ".-...": "&",
            "---...": ":",
            "-.-.-.": ";",
            "-...-": "=",
            ".-.-.": "+",
            "-....-": "-",
            "..--.-": "_",
            ".-..-.": '"',
            "...-..-": "$",
            ".--.-.": "@",
          };
          const out = (await file.text())
            .trim()
            .split(/\s*\/\s*|\s{2,}/)
            .map((w) =>
              w
                .split(/\s+/)
                .map((t) => M[t] ?? "")
                .join(""),
            )
            .join(" ");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.txt`,
          };
        },
      },
    ],
  },
  {
    id: "rot13",
    category: "Encoders",
    title: "ROT13 cipher",
    description: "Apply the ROT13 substitution cipher (encode and decode are the same operation).",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "ROT13",
        description: "Shift every ASCII letter by 13 places.",
        run: async (file) => {
          const out = (await file.text()).replace(/[a-zA-Z]/g, (c) => {
            const base = c <= "Z" ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
          });
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.rot13.txt`,
          };
        },
      },
    ],
  },
  {
    id: "caesar-cipher",
    category: "Encoders",
    title: "Caesar cipher (shift 3)",
    description: "Classic Caesar cipher with a fixed +3 shift; use the decode option to reverse.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Encode (+3)",
        description: "Shift ASCII letters forward by 3.",
        run: async (file) => {
          const shift = (s: string, n: number) =>
            s.replace(/[a-zA-Z]/g, (c) => {
              const b = c <= "Z" ? 65 : 97;
              return String.fromCharCode(((c.charCodeAt(0) - b + n + 26) % 26) + b);
            });
          return {
            blob: new Blob([shift(await file.text(), 3)], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.caesar.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Decode (−3)",
        description: "Shift ASCII letters backward by 3.",
        run: async (file) => {
          const shift = (s: string, n: number) =>
            s.replace(/[a-zA-Z]/g, (c) => {
              const b = c <= "Z" ? 65 : 97;
              return String.fromCharCode(((c.charCodeAt(0) - b + n + 26) % 26) + b);
            });
          return {
            blob: new Blob([shift(await file.text(), -3)], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.plain.txt`,
          };
        },
      },
    ],
  },
  {
    id: "number-to-words",
    category: "Text",
    title: "Number to words",
    description: "Convert integers (one per line) into their written English form.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "English words",
        description: "Supports integers up to 999,999,999,999,999.",
        run: async (file) => {
          const ones = [
            "",
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
            "ten",
            "eleven",
            "twelve",
            "thirteen",
            "fourteen",
            "fifteen",
            "sixteen",
            "seventeen",
            "eighteen",
            "nineteen",
          ];
          const tens = [
            "",
            "",
            "twenty",
            "thirty",
            "forty",
            "fifty",
            "sixty",
            "seventy",
            "eighty",
            "ninety",
          ];
          const scales = ["", "thousand", "million", "billion", "trillion"];
          const under1000 = (n: number): string => {
            if (n === 0) return "";
            if (n < 20) return ones[n];
            if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10] : "");
            return (
              ones[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + under1000(n % 100) : "")
            );
          };
          const toWords = (num: number): string => {
            if (num === 0) return "zero";
            const neg = num < 0;
            num = Math.abs(num);
            const parts: string[] = [];
            let i = 0;
            while (num > 0) {
              const chunk = num % 1000;
              if (chunk) parts.unshift(under1000(chunk) + (scales[i] ? " " + scales[i] : ""));
              num = Math.floor(num / 1000);
              i++;
            }
            return (neg ? "negative " : "") + parts.join(" ");
          };
          const out = (await file.text())
            .split(/\r?\n/)
            .map((line) => {
              const s = line.trim();
              if (!s) return "";
              const n = Number(s);
              if (!Number.isFinite(n) || !Number.isInteger(n)) return `[invalid: ${s}]`;
              return toWords(n);
            })
            .join("\n");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.words.txt`,
          };
        },
      },
    ],
  },
  {
    id: "roman-numerals",
    category: "Text",
    title: "Roman numerals ↔ number",
    description: "Convert integers 1-3999 to Roman numerals, or Roman numerals back to integers.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Number → Roman",
        description: "One integer per line (1-3999).",
        run: async (file) => {
          const table: [number, string][] = [
            [1000, "M"],
            [900, "CM"],
            [500, "D"],
            [400, "CD"],
            [100, "C"],
            [90, "XC"],
            [50, "L"],
            [40, "XL"],
            [10, "X"],
            [9, "IX"],
            [5, "V"],
            [4, "IV"],
            [1, "I"],
          ];
          const toRoman = (n: number) => {
            if (n < 1 || n > 3999) return `[out of range: ${n}]`;
            let out = "";
            for (const [v, s] of table)
              while (n >= v) {
                out += s;
                n -= v;
              }
            return out;
          };
          const out = (await file.text())
            .split(/\r?\n/)
            .map((l) => {
              const s = l.trim();
              if (!s) return "";
              const n = parseInt(s, 10);
              return Number.isFinite(n) ? toRoman(n) : `[invalid: ${s}]`;
            })
            .join("\n");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.roman.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Roman → number",
        description: "One numeral per line.",
        run: async (file) => {
          const V: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
          const parse = (s: string) => {
            let total = 0,
              prev = 0;
            for (let i = s.length - 1; i >= 0; i--) {
              const v = V[s[i]];
              if (!v) return NaN;
              if (v < prev) total -= v;
              else {
                total += v;
                prev = v;
              }
            }
            return total;
          };
          const out = (await file.text())
            .split(/\r?\n/)
            .map((l) => {
              const s = l.trim().toUpperCase();
              if (!s) return "";
              const n = parse(s);
              return Number.isFinite(n) ? String(n) : `[invalid: ${s}]`;
            })
            .join("\n");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.numbers.txt`,
          };
        },
      },
    ],
  },
  {
    id: "text-statistics",
    category: "Text",
    title: "Text statistics report",
    description: "Word, character, sentence, paragraph, line count and estimated reading time.",
    accept: ".txt,.md,text/plain",
    inputExts: ["TXT", "MD"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Stats report",
        description: "Plain-text summary of the input's readability metrics.",
        run: async (file) => {
          const t = await file.text();
          const chars = t.length;
          const charsNoSpaces = t.replace(/\s/g, "").length;
          const words = (t.match(/\b[\w'-]+\b/g) ?? []).length;
          const sentences = (t.match(/[.!?]+(?=\s|$)/g) ?? []).length;
          const paragraphs = t.split(/\n\s*\n/).filter((p) => p.trim()).length;
          const lines = t.split(/\r?\n/).length;
          const wpm = READING_WPM;
          const mins = words / wpm;
          const readMin = Math.floor(mins);
          const readSec = Math.round((mins - readMin) * 60);
          const out = [
            `Text statistics - ${file.name}`,
            "-".repeat(40),
            `Characters:            ${chars}`,
            `Characters (no space): ${charsNoSpaces}`,
            `Words:                 ${words}`,
            `Sentences:             ${sentences}`,
            `Paragraphs:            ${paragraphs}`,
            `Lines:                 ${lines}`,
            `Reading time (~${READING_WPM}wpm): ${readMin}m ${readSec}s`,
          ].join("\n");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(file.name)}.stats.txt`,
          };
        },
      },
    ],
  },
  {
    id: "xml-prettify",
    category: "Developer",
    title: "XML prettify",
    description: "Format and indent minified or messy XML for easy reading.",
    accept: ".xml,application/xml,text/xml",
    inputExts: ["XML"],
    mode: "per-file",
    outputs: [
      {
        ext: "XML",
        label: "Pretty XML",
        description: "2-space indent, one node per line.",
        run: async (file) => {
          const src = (await file.text()).replace(/>\s+</g, "><").trim();
          let indent = 0;
          const out: string[] = [];
          const tokens = src.match(/<[^>]+>|[^<]+/g) ?? [];
          for (const tok of tokens) {
            if (/^<\/[^>]+>/.test(tok)) {
              indent = Math.max(0, indent - 1);
              out.push("  ".repeat(indent) + tok);
            } else if (/^<[^!?][^>]*[^/]>$/.test(tok)) {
              out.push("  ".repeat(indent) + tok);
              indent++;
            } else {
              out.push("  ".repeat(indent) + tok);
            }
          }
          return {
            blob: new Blob([out.join("\n")], { type: "application/xml" }),
            filename: `${stripExt(file.name)}.pretty.xml`,
          };
        },
      },
    ],
  },
  {
    id: "markdown-to-html",
    category: "Documents",
    title: "Markdown → HTML",
    description:
      "Convert Markdown (headings, lists, links, code, bold/italic) to a standalone HTML document.",
    accept: ".md,.markdown,text/markdown,text/plain",
    inputExts: ["MD", "MARKDOWN", "TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "HTML",
        label: "HTML document",
        description: "Basic Markdown subset - good for previews, not full CommonMark.",
        run: async (file) => {
          const md = await file.text();
          const esc = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const lines = md.split(/\r?\n/);
          const out: string[] = [];
          let inCode = false,
            inList = false;
          for (const raw of lines) {
            if (raw.startsWith("```")) {
              if (inCode) {
                out.push("</code></pre>");
                inCode = false;
              } else {
                out.push("<pre><code>");
                inCode = true;
              }
              continue;
            }
            if (inCode) {
              out.push(esc(raw));
              continue;
            }
            const h = raw.match(/^(#{1,6})\s+(.*)$/);
            if (h) {
              if (inList) {
                out.push("</ul>");
                inList = false;
              }
              out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
              continue;
            }
            if (/^[-*]\s+/.test(raw)) {
              if (!inList) {
                out.push("<ul>");
                inList = true;
              }
              out.push(`<li>${inline(raw.replace(/^[-*]\s+/, ""))}</li>`);
              continue;
            }
            if (inList) {
              out.push("</ul>");
              inList = false;
            }
            if (raw.trim() === "") out.push("");
            else out.push(`<p>${inline(raw)}</p>`);
          }
          if (inList) out.push("</ul>");
          if (inCode) out.push("</code></pre>");
          function inline(s: string) {
            return esc(s)
              .replace(/`([^`]+)`/g, "<code>$1</code>")
              .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
              .replace(/\*([^*]+)\*/g, "<em>$1</em>")
              .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
          }
          const html = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(stripExt(file.name))}</title>\n<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6}pre{background:#f4f4f5;padding:1rem;border-radius:6px;overflow:auto}code{font-family:ui-monospace,monospace}</style>\n</head><body>\n${out.join("\n")}\n</body></html>\n`;
          return {
            blob: new Blob([html], { type: "text/html" }),
            filename: `${stripExt(file.name)}.html`,
          };
        },
      },
    ],
  },
  {
    id: "text-case-converter",
    category: "Text",
    title: "Text case converter",
    description:
      "Convert text between UPPER, lower, Title, Sentence, camelCase, snake_case, and kebab-case.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "UPPERCASE",
        description: "All characters uppercased.",
        run: async (f) => ({
          blob: new Blob([(await f.text()).toUpperCase()], { type: "text/plain" }),
          filename: `${stripExt(f.name)}.upper.txt`,
        }),
      },
      {
        ext: "TXT",
        label: "lowercase",
        description: "All characters lowercased.",
        run: async (f) => ({
          blob: new Blob([(await f.text()).toLowerCase()], { type: "text/plain" }),
          filename: `${stripExt(f.name)}.lower.txt`,
        }),
      },
      {
        ext: "TXT",
        label: "Title Case",
        description: "Capitalise the first letter of each word.",
        run: async (f) => ({
          blob: new Blob(
            [(await f.text()).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())],
            { type: "text/plain" },
          ),
          filename: `${stripExt(f.name)}.title.txt`,
        }),
      },
      {
        ext: "TXT",
        label: "Sentence case",
        description: "Capitalise the first letter of each sentence.",
        run: async (f) => ({
          blob: new Blob(
            [
              (await f.text())
                .toLowerCase()
                .replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase()),
            ],
            { type: "text/plain" },
          ),
          filename: `${stripExt(f.name)}.sentence.txt`,
        }),
      },
      {
        ext: "TXT",
        label: "camelCase",
        description: "Words joined, first lowercase, rest capitalised.",
        run: async (f) => {
          const w = (await f.text()).match(/[A-Za-z0-9]+/g) ?? [];
          return {
            blob: new Blob(
              [
                w
                  .map((s, i) =>
                    i ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s.toLowerCase(),
                  )
                  .join(""),
              ],
              { type: "text/plain" },
            ),
            filename: `${stripExt(f.name)}.camel.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "snake_case",
        description: "Lowercase words joined by underscores.",
        run: async (f) => {
          const w = (await f.text()).match(/[A-Za-z0-9]+/g) ?? [];
          return {
            blob: new Blob([w.map((s) => s.toLowerCase()).join("_")], { type: "text/plain" }),
            filename: `${stripExt(f.name)}.snake.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "kebab-case",
        description: "Lowercase words joined by hyphens.",
        run: async (f) => {
          const w = (await f.text()).match(/[A-Za-z0-9]+/g) ?? [];
          return {
            blob: new Blob([w.map((s) => s.toLowerCase()).join("-")], { type: "text/plain" }),
            filename: `${stripExt(f.name)}.kebab.txt`,
          };
        },
      },
    ],
  },
  {
    id: "reverse-text",
    category: "Text",
    title: "Reverse text",
    description: "Reverse characters, words, or line order.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Reverse characters",
        description: "Reverse every character.",
        run: async (f) => ({
          blob: new Blob([[...(await f.text())].reverse().join("")], { type: "text/plain" }),
          filename: `${stripExt(f.name)}.reversed.txt`,
        }),
      },
      {
        ext: "TXT",
        label: "Reverse words",
        description: "Reverse word order within each line.",
        run: async (f) => ({
          blob: new Blob(
            [
              (await f.text())
                .split(/\r?\n/)
                .map((l) => l.split(/\s+/).reverse().join(" "))
                .join("\n"),
            ],
            { type: "text/plain" },
          ),
          filename: `${stripExt(f.name)}.words-reversed.txt`,
        }),
      },
      {
        ext: "TXT",
        label: "Reverse lines",
        description: "Reverse the order of lines in the file.",
        run: async (f) => ({
          blob: new Blob([(await f.text()).split(/\r?\n/).reverse().join("\n")], {
            type: "text/plain",
          }),
          filename: `${stripExt(f.name)}.lines-reversed.txt`,
        }),
      },
    ],
  },
  {
    id: "remove-duplicates",
    category: "Text",
    title: "Remove duplicate lines",
    description: "Deduplicate lines in a text file. Optionally sort or trim whitespace.",
    accept: ".txt,text/plain",
    inputExts: ["TXT"],
    mode: "per-file",
    outputs: [
      {
        ext: "TXT",
        label: "Unique lines",
        description: "Keep first occurrence, original order.",
        run: async (f) => {
          const seen = new Set<string>();
          const out = (await f.text())
            .split(/\r?\n/)
            .filter((l) => {
              if (seen.has(l)) return false;
              seen.add(l);
              return true;
            })
            .join("\n");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(f.name)}.unique.txt`,
          };
        },
      },
      {
        ext: "TXT",
        label: "Unique + sorted",
        description: "Deduplicate then sort alphabetically.",
        run: async (f) => {
          const out = [...new Set((await f.text()).split(/\r?\n/))].sort().join("\n");
          return {
            blob: new Blob([out], { type: "text/plain" }),
            filename: `${stripExt(f.name)}.unique-sorted.txt`,
          };
        },
      },
    ],
  },
];

async function curlConvert(
  file: File,
  target: "fetch" | "axios" | "python",
): Promise<ConvertResult> {
  const src = (await file.text()).replace(/\\\r?\n/g, " ").trim();
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)/g;
  let m;
  while ((m = re.exec(src))) tokens.push(m[1] ?? m[2] ?? m[3]);
  if (tokens[0] === "curl") tokens.shift();
  let url = "";
  let method = "GET";
  const headers: Record<string, string> = {};
  let body: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-X" || t === "--request") method = tokens[++i]?.toUpperCase() ?? "GET";
    else if (t === "-H" || t === "--header") {
      const [k, ...rest] = (tokens[++i] ?? "").split(":");
      headers[k.trim()] = rest.join(":").trim();
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary") {
      body = tokens[++i] ?? null;
      if (method === "GET") method = "POST";
    } else if (t === "-u" || t === "--user") {
      headers.Authorization = "Basic " + btoa(tokens[++i] ?? "");
    } else if (!t.startsWith("-") && !url) url = t;
  }
  const base = stripExt(file.name);
  if (target === "fetch") {
    const code = `const res = await fetch(${JSON.stringify(url)}, ${JSON.stringify({ method, headers, body }, null, 2)});\nconst data = await res.text();\nconsole.log(data);\n`;
    return { blob: new Blob([code], { type: "text/javascript" }), filename: `${base}.fetch.js` };
  }
  if (target === "axios") {
    const code = `import axios from "axios";\nconst res = await axios(${JSON.stringify({ url, method, headers, data: body }, null, 2)});\nconsole.log(res.data);\n`;
    return { blob: new Blob([code], { type: "text/javascript" }), filename: `${base}.axios.js` };
  }
  const py = `import requests\nres = requests.request(${JSON.stringify(method)}, ${JSON.stringify(url)}, headers=${JSON.stringify(headers)}, data=${body ? JSON.stringify(body) : "None"})\nprint(res.text)\n`;
  return { blob: new Blob([py], { type: "text/x-python" }), filename: `${base}.py` };
}

export type FamilyGroup = { title: string; items: Family[] };
export const groups: FamilyGroup[] = Array.from(
  families.reduce((map, f) => {
    const arr = map.get(f.category) ?? [];
    arr.push(f);
    map.set(f.category, arr);
    return map;
  }, new Map<string, Family[]>()),
).map(([title, items]) => ({ title, items }));
