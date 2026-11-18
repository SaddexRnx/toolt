// Color-suite calculators (Batch C). Pure math, no deps.
import type { Calculator } from "./calculators";

// ----- Parsing / conversion -----
export function parseColor(input: string): { r: number; g: number; b: number; a: number } | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  // #hex
  let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3)
      h =
        h
          .split("")
          .map((c) => c + c)
          .join("") + "ff";
    else if (h.length === 4)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    else if (h.length === 6) h = h + "ff";
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = parseInt(h.slice(6, 8), 16) / 255;
    return { r, g, b, a };
  }
  // rgb(a) - legacy comma syntax and modern space syntax with / alpha and % channels
  m = s.match(
    /^rgba?\(\s*(-?[\d.]+%?)[,\s]+(-?[\d.]+%?)[,\s]+(-?[\d.]+%?)(?:[,\s/]+(-?[\d.]+%?))?\s*\)$/,
  );
  if (m) {
    const chan = (t: string) =>
      t.endsWith("%") ? clamp255((parseFloat(t) / 100) * 255) : clamp255(parseFloat(t));
    const r = chan(m[1]);
    const g = chan(m[2]);
    const b = chan(m[3]);
    let a = 1;
    if (m[4] != null) a = m[4].endsWith("%") ? +m[4].slice(0, -1) / 100 : +m[4];
    return { r, g, b, a: clamp01(a) };
  }
  // hsl(a) - degrees may be negative; S/L are percentages
  m = s.match(
    /^hsla?\(\s*(-?[\d.]+)(?:deg)?(?:%?)[,\s]+(-?[\d.]+)%[,\s]+(-?[\d.]+)%(?:[,\s/]+(-?[\d.]+%?))?\s*\)$/,
  );
  if (m) {
    // S and L arrive as percentages (0-100); clampPct keeps them there.
    // clamp01 would squash every value >= 1 down to 100%, so hsl(210, 50%, 40%)
    // used to come out as a fully saturated 100%/100% colour.
    const rgb = hslToRgb(+m[1], clampPct(+m[2]), clampPct(+m[3]));
    let a = 1;
    if (m[4] != null) a = m[4].endsWith("%") ? +m[4].slice(0, -1) / 100 : +m[4];
    return { ...rgb, a: clamp01(a) };
  }
  return null;
}
const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clampPct = (n: number) => Math.max(0, Math.min(100, n));

export function toHex({ r, g, b, a = 1 }: { r: number; g: number; b: number; a?: number }) {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  const base = "#" + h(r) + h(g) + h(b);
  return a < 1 ? base + h(Math.round(a * 255)) : base;
}
export function rgbToHsl(r: number, g: number, b: number) {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case R:
        h = (G - B) / d + (G < B ? 6 : 0);
        break;
      case G:
        h = (B - R) / d + 2;
        break;
      case B:
        h = (R - G) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
export function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360;
  const S = s / 100,
    L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  let r: number, g: number, b: number;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255) };
}
export function rgbToHsv(r: number, g: number, b: number) {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case R:
        h = (G - B) / d + (G < B ? 6 : 0);
        break;
      case G:
        h = (B - R) / d + 2;
        break;
      case B:
        h = (R - G) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s: s * 100, v: v * 100 };
}
export function rgbToCmyk(r: number, g: number, b: number) {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - R - k) / (1 - k);
  const m = (1 - G - k) / (1 - k);
  const y = (1 - B - k) / (1 - k);
  return { c: c * 100, m: m * 100, y: y * 100, k: k * 100 };
}

function relLum(r: number, g: number, b: number) {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
) {
  const L1 = relLum(a.r, a.g, a.b),
    L2 = relLum(b.r, b.g, b.b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

function shiftHue(hex: string, delta: number) {
  const p = parseColor(hex)!;
  const { h, s, l } = rgbToHsl(p.r, p.g, p.b);
  const rgb = hslToRgb(h + delta, s, l);
  return toHex(rgb);
}
function withLight(hex: string, l: number) {
  const p = parseColor(hex)!;
  const hsl = rgbToHsl(p.r, p.g, p.b);
  const rgb = hslToRgb(hsl.h, hsl.s, clamp01(l / 100) * 100);
  return toHex(rgb);
}
function mixColors(a: string, b: string, ratio: number) {
  const A = parseColor(a)!,
    B = parseColor(b)!;
  const t = clamp01(ratio);
  return toHex({
    r: clamp255(A.r * (1 - t) + B.r * t),
    g: clamp255(A.g * (1 - t) + B.g * t),
    b: clamp255(A.b * (1 - t) + B.b * t),
  });
}

const err = (msg: string) => [{ label: "Error", value: msg }];

export const colorCalculators: Calculator[] = [
  {
    id: "color-convert",
    category: "Color",
    title: "Color converter (HEX ↔ RGB ↔ HSL ↔ HSV ↔ CMYK)",
    description: "Enter any CSS color and get every format instantly.",
    fields: [
      {
        id: "color",
        label: "Color",
        type: "text",
        default: "#3b82f6",
        placeholder: "#hex, rgb(), or hsl()",
      },
    ],
    compute: (v) => {
      const p = parseColor(v.color);
      if (!p) return err("Invalid color. Try #3b82f6, rgb(59,130,246), or hsl(217,91%,60%).");
      const hex = toHex(p);
      const hsl = rgbToHsl(p.r, p.g, p.b);
      const hsv = rgbToHsv(p.r, p.g, p.b);
      const cmyk = rgbToCmyk(p.r, p.g, p.b);
      return [
        { label: "Preview", value: hex.toUpperCase(), swatch: hex },
        { label: "HEX", value: hex.toUpperCase() },
        { label: "RGB", value: `rgb(${p.r}, ${p.g}, ${p.b})` },
        {
          label: "HSL",
          value: `hsl(${hsl.h.toFixed(0)}, ${hsl.s.toFixed(0)}%, ${hsl.l.toFixed(0)}%)`,
        },
        {
          label: "HSV",
          value: `hsv(${hsv.h.toFixed(0)}, ${hsv.s.toFixed(0)}%, ${hsv.v.toFixed(0)}%)`,
        },
        {
          label: "CMYK",
          value: `cmyk(${cmyk.c.toFixed(0)}%, ${cmyk.m.toFixed(0)}%, ${cmyk.y.toFixed(0)}%, ${cmyk.k.toFixed(0)}%)`,
        },
        { label: "Alpha", value: p.a.toFixed(2) },
      ];
    },
  },
  {
    id: "color-palette",
    category: "Color",
    title: "Palette generator",
    description:
      "Harmony palettes from a base color: complementary, triadic, tetradic, analogous, split, monochromatic.",
    fields: [
      { id: "color", label: "Base color", type: "text", default: "#3b82f6" },
      {
        id: "scheme",
        label: "Scheme",
        type: "select",
        default: "triadic",
        options: [
          { value: "complementary", label: "Complementary (2)" },
          { value: "split", label: "Split complementary (3)" },
          { value: "triadic", label: "Triadic (3)" },
          { value: "tetradic", label: "Tetradic (4)" },
          { value: "analogous", label: "Analogous (5)" },
          { value: "monochromatic", label: "Monochromatic (5)" },
        ],
      },
    ],
    compute: (v) => {
      const p = parseColor(v.color);
      if (!p) return err("Invalid base color.");
      const base = toHex(p);
      let out: string[] = [];
      switch (v.scheme) {
        case "complementary":
          out = [base, shiftHue(base, 180)];
          break;
        case "split":
          out = [base, shiftHue(base, 150), shiftHue(base, 210)];
          break;
        case "triadic":
          out = [base, shiftHue(base, 120), shiftHue(base, 240)];
          break;
        case "tetradic":
          out = [base, shiftHue(base, 90), shiftHue(base, 180), shiftHue(base, 270)];
          break;
        case "analogous":
          out = [
            shiftHue(base, -40),
            shiftHue(base, -20),
            base,
            shiftHue(base, 20),
            shiftHue(base, 40),
          ];
          break;
        case "monochromatic": {
          const hsl = rgbToHsl(p.r, p.g, p.b);
          out = [20, 35, hsl.l, 65, 85].map((l) => toHex(hslToRgb(hsl.h, hsl.s, l)));
          break;
        }
      }
      return [
        { label: "Palette", value: `${out.length} colors`, swatches: out },
        ...out.map((c, i) => ({ label: `Color ${i + 1}`, value: c.toUpperCase(), swatch: c })),
      ];
    },
  },
  {
    id: "color-shades-tints",
    category: "Color",
    title: "Shades & tints generator",
    description: "10 shades (darker) and 10 tints (lighter) of a base color.",
    fields: [{ id: "color", label: "Base color", type: "text", default: "#3b82f6" }],
    compute: (v) => {
      const p = parseColor(v.color);
      if (!p) return err("Invalid color.");
      const shades = Array.from({ length: 10 }, (_, i) =>
        mixColors(toHex(p), "#000000", (i + 1) / 11),
      );
      const tints = Array.from({ length: 10 }, (_, i) =>
        mixColors(toHex(p), "#ffffff", (i + 1) / 11),
      );
      return [
        { label: "Base", value: toHex(p).toUpperCase(), swatch: toHex(p) },
        { label: "Shades (→ black)", value: `${shades.length}`, swatches: shades },
        { label: "Tints (→ white)", value: `${tints.length}`, swatches: tints },
      ];
    },
  },
  {
    id: "color-mixer",
    category: "Color",
    title: "Color mixer",
    description: "Blend two colors at a chosen ratio.",
    fields: [
      { id: "a", label: "Color A", type: "text", default: "#3b82f6" },
      { id: "b", label: "Color B", type: "text", default: "#f59e0b" },
      {
        id: "ratio",
        label: "B amount",
        type: "number",
        default: 50,
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
      },
    ],
    compute: (v) => {
      if (!parseColor(v.a) || !parseColor(v.b)) return err("Invalid color.");
      const t = Math.max(0, Math.min(100, +v.ratio || 0)) / 100;
      const mid = mixColors(v.a, v.b, t);
      const scale = [0, 0.25, 0.5, 0.75, 1].map((r) => mixColors(v.a, v.b, r));
      return [
        { label: "Mixed", value: mid.toUpperCase(), swatch: mid },
        { label: "Gradient scale", value: "0 → 100%", swatches: scale },
      ];
    },
  },
  {
    id: "contrast-checker",
    category: "Color",
    title: "WCAG contrast checker",
    description: "Foreground vs background contrast ratio with AA / AAA pass badges.",
    fields: [
      { id: "fg", label: "Foreground (text)", type: "text", default: "#111111" },
      { id: "bg", label: "Background", type: "text", default: "#ffffff" },
    ],
    compute: (v) => {
      const fg = parseColor(v.fg),
        bg = parseColor(v.bg);
      if (!fg || !bg) return err("Invalid color.");
      const ratio = contrastRatio(fg, bg);
      const pass = (min: number) => (ratio >= min ? "PASS" : "FAIL");
      return [
        { label: "Foreground", value: toHex(fg).toUpperCase(), swatch: toHex(fg) },
        { label: "Background", value: toHex(bg).toUpperCase(), swatch: toHex(bg) },
        { label: "Contrast ratio", value: `${ratio.toFixed(2)} : 1` },
        { label: "AA - normal text (≥ 4.5)", value: pass(4.5) },
        { label: "AA - large text (≥ 3)", value: pass(3) },
        { label: "AAA - normal text (≥ 7)", value: pass(7) },
        { label: "AAA - large text (≥ 4.5)", value: pass(4.5) },
      ];
    },
  },
  {
    id: "gradient-builder",
    category: "Color",
    title: "CSS gradient builder",
    description: "Two-stop linear or radial gradient with copy-ready CSS.",
    fields: [
      {
        id: "type",
        label: "Type",
        type: "select",
        default: "linear",
        options: [
          { value: "linear", label: "Linear" },
          { value: "radial", label: "Radial" },
        ],
      },
      {
        id: "angle",
        label: "Angle (linear only)",
        type: "number",
        default: 90,
        min: 0,
        max: 360,
        unit: "deg",
      },
      { id: "a", label: "Start color", type: "text", default: "#3b82f6" },
      { id: "b", label: "End color", type: "text", default: "#a855f7" },
    ],
    compute: (v) => {
      if (!parseColor(v.a) || !parseColor(v.b)) return err("Invalid color.");
      const css =
        v.type === "radial"
          ? `radial-gradient(circle, ${v.a}, ${v.b})`
          : `linear-gradient(${num(v.angle)}deg, ${v.a}, ${v.b})`;
      const preview = [v.a, mixColors(v.a, v.b, 0.5), v.b];
      return [
        { label: "Preview", value: v.type, swatches: preview },
        { label: "CSS background", value: `background: ${css};` },
        { label: "Tailwind (arbitrary)", value: `bg-[${css.replace(/\s/g, "_")}]` },
      ];
    },
  },
  {
    id: "color-random",
    category: "Color",
    title: "Random color",
    description: "Generate a random color with tweakable saturation and lightness.",
    fields: [
      {
        id: "seed",
        label: "Reroll (change to regenerate)",
        type: "number",
        default: 1,
        min: 1,
        max: 999999,
        step: 1,
      },
      { id: "sat", label: "Saturation", type: "number", default: 70, min: 0, max: 100, unit: "%" },
      { id: "light", label: "Lightness", type: "number", default: 55, min: 0, max: 100, unit: "%" },
    ],
    compute: (v) => {
      // Deterministic per seed so results are stable in the preview.
      const seed = Math.abs(Math.floor(+v.seed || 1));
      const h = (seed * 137.508) % 360;
      const rgb = hslToRgb(h, num(v.sat, 70), num(v.light, 55));
      const hex = toHex(rgb);
      return [
        { label: "Preview", value: hex.toUpperCase(), swatch: hex },
        { label: "HEX", value: hex.toUpperCase() },
        { label: "RGB", value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
        { label: "HSL", value: `hsl(${h.toFixed(0)}, ${num(v.sat, 70)}%, ${num(v.light, 55)}%)` },
      ];
    },
  },
];

function num(v: string, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
