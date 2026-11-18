// CSS builder tools (Batch D). Interactive style generators with live preview.
import type { Calculator } from "./calculators";

const n = (v: string, f = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : f;
};

export const cssCalculators: Calculator[] = [
  // ---------------- Box shadow ----------------
  {
    id: "css-box-shadow",
    category: "CSS",
    title: "Box-shadow builder",
    description: "Craft a box-shadow with offset, blur, spread, color, and inset toggle.",
    fields: [
      { id: "x", label: "Offset X", type: "number", default: 0, min: -100, max: 100, unit: "px" },
      { id: "y", label: "Offset Y", type: "number", default: 8, min: -100, max: 100, unit: "px" },
      {
        id: "blur",
        label: "Blur radius",
        type: "number",
        default: 24,
        min: 0,
        max: 200,
        unit: "px",
      },
      {
        id: "spread",
        label: "Spread",
        type: "number",
        default: -4,
        min: -100,
        max: 100,
        unit: "px",
      },
      { id: "color", label: "Color (rgba/hex)", type: "text", default: "rgba(0,0,0,0.25)" },
      {
        id: "inset",
        label: "Inset",
        type: "select",
        default: "no",
        options: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
        ],
      },
    ],
    compute: (v) => {
      const parts = [
        v.inset === "yes" ? "inset" : "",
        `${n(v.x)}px`,
        `${n(v.y)}px`,
        `${n(v.blur)}px`,
        `${n(v.spread)}px`,
        v.color,
      ]
        .filter(Boolean)
        .join(" ");
      return [
        {
          label: "Preview",
          value: "",
          preview: {
            style: { boxShadow: parts, background: "#fff", borderRadius: "12px" },
            text: " ",
          },
        },
        { label: "CSS", value: `box-shadow: ${parts};` },
        { label: "Tailwind", value: `shadow-[${parts.replace(/\s+/g, "_")}]` },
      ];
    },
  },

  // ---------------- Text shadow ----------------
  {
    id: "css-text-shadow",
    category: "CSS",
    title: "Text-shadow builder",
    description: "Add glow, drop shadow, or retro effects to text.",
    fields: [
      { id: "text", label: "Text", type: "text", default: "Hello world" },
      { id: "x", label: "Offset X", type: "number", default: 2, min: -50, max: 50, unit: "px" },
      { id: "y", label: "Offset Y", type: "number", default: 2, min: -50, max: 50, unit: "px" },
      { id: "blur", label: "Blur", type: "number", default: 6, min: 0, max: 100, unit: "px" },
      { id: "color", label: "Shadow color", type: "text", default: "rgba(0,0,0,0.5)" },
      { id: "size", label: "Font size", type: "number", default: 36, min: 8, max: 120, unit: "px" },
      { id: "textColor", label: "Text color", type: "text", default: "#111111" },
    ],
    compute: (v) => {
      const shadow = `${n(v.x)}px ${n(v.y)}px ${n(v.blur)}px ${v.color}`;
      return [
        {
          label: "Preview",
          value: "",
          preview: {
            style: {
              textShadow: shadow,
              fontSize: `${n(v.size, 36)}px`,
              color: v.textColor,
              fontWeight: 700,
              background: "#fff",
            },
            text: v.text || "Preview",
          },
        },
        { label: "CSS", value: `text-shadow: ${shadow};` },
      ];
    },
  },

  // ---------------- Border radius ----------------
  {
    id: "css-border-radius",
    category: "CSS",
    title: "Border-radius builder",
    description: "Independent corner radii with live preview.",
    fields: [
      { id: "tl", label: "Top-left", type: "number", default: 16, min: 0, max: 200, unit: "px" },
      { id: "tr", label: "Top-right", type: "number", default: 16, min: 0, max: 200, unit: "px" },
      {
        id: "br",
        label: "Bottom-right",
        type: "number",
        default: 16,
        min: 0,
        max: 200,
        unit: "px",
      },
      { id: "bl", label: "Bottom-left", type: "number", default: 16, min: 0, max: 200, unit: "px" },
    ],
    compute: (v) => {
      const r = `${n(v.tl)}px ${n(v.tr)}px ${n(v.br)}px ${n(v.bl)}px`;
      return [
        {
          label: "Preview",
          value: "",
          preview: {
            style: { borderRadius: r, background: "linear-gradient(135deg,#3b82f6,#a855f7)" },
            text: " ",
          },
        },
        { label: "CSS", value: `border-radius: ${r};` },
      ];
    },
  },

  // ---------------- Button generator ----------------
  {
    id: "css-button",
    category: "CSS",
    title: "Button generator",
    description: "Style a button with colors, padding, radius, and shadow.",
    fields: [
      { id: "label", label: "Label", type: "text", default: "Click me" },
      { id: "bg", label: "Background", type: "text", default: "#111111" },
      { id: "fg", label: "Text color", type: "text", default: "#ffffff" },
      { id: "px", label: "Padding X", type: "number", default: 20, min: 0, max: 80, unit: "px" },
      { id: "py", label: "Padding Y", type: "number", default: 12, min: 0, max: 60, unit: "px" },
      {
        id: "radius",
        label: "Border radius",
        type: "number",
        default: 8,
        min: 0,
        max: 100,
        unit: "px",
      },
      { id: "size", label: "Font size", type: "number", default: 15, min: 10, max: 40, unit: "px" },
      {
        id: "weight",
        label: "Font weight",
        type: "select",
        default: "600",
        options: [
          { value: "400", label: "Regular" },
          { value: "500", label: "Medium" },
          { value: "600", label: "Semibold" },
          { value: "700", label: "Bold" },
        ],
      },
      {
        id: "shadow",
        label: "Shadow",
        type: "select",
        default: "md",
        options: [
          { value: "none", label: "None" },
          { value: "sm", label: "Small" },
          { value: "md", label: "Medium" },
          { value: "lg", label: "Large" },
        ],
      },
    ],
    compute: (v) => {
      const shadowMap: Record<string, string> = {
        none: "none",
        sm: "0 1px 2px rgba(0,0,0,0.15)",
        md: "0 4px 12px rgba(0,0,0,0.15)",
        lg: "0 12px 32px rgba(0,0,0,0.2)",
      };
      const style: Record<string, string> = {
        backgroundColor: v.bg,
        color: v.fg,
        padding: `${n(v.py)}px ${n(v.px)}px`,
        borderRadius: `${n(v.radius)}px`,
        fontSize: `${n(v.size, 15)}px`,
        fontWeight: v.weight,
        boxShadow: shadowMap[v.shadow] ?? "none",
        border: "none",
        display: "inline-block",
        cursor: "pointer",
      };
      const css = `background: ${v.bg};\ncolor: ${v.fg};\npadding: ${n(v.py)}px ${n(v.px)}px;\nborder-radius: ${n(v.radius)}px;\nfont-size: ${n(v.size, 15)}px;\nfont-weight: ${v.weight};\nbox-shadow: ${shadowMap[v.shadow]};\nborder: none;\ncursor: pointer;`;
      return [
        {
          label: "Preview",
          value: "",
          preview: { style, text: v.label || "Button", bg: "#f5f5f5" },
        },
        { label: "CSS", value: css },
      ];
    },
  },

  // ---------------- Gradient text ----------------
  {
    id: "css-gradient-text",
    category: "CSS",
    title: "Gradient text",
    description: "Apply a linear gradient to text using background-clip.",
    fields: [
      { id: "text", label: "Text", type: "text", default: "Gradient" },
      { id: "angle", label: "Angle", type: "number", default: 90, min: 0, max: 360, unit: "deg" },
      { id: "a", label: "Color A", type: "text", default: "#3b82f6" },
      { id: "b", label: "Color B", type: "text", default: "#a855f7" },
      {
        id: "size",
        label: "Font size",
        type: "number",
        default: 48,
        min: 12,
        max: 160,
        unit: "px",
      },
    ],
    compute: (v) => {
      const bg = `linear-gradient(${n(v.angle)}deg, ${v.a}, ${v.b})`;
      const style: Record<string, string> = {
        backgroundImage: bg,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        fontSize: `${n(v.size, 48)}px`,
        fontWeight: "800",
        background: bg,
        WebkitTextFillColor: "transparent",
      };
      const css = `background: ${bg};\n-webkit-background-clip: text;\nbackground-clip: text;\ncolor: transparent;`;
      return [
        {
          label: "Preview",
          value: "",
          preview: { style, text: v.text || "Gradient", bg: "#ffffff" },
        },
        { label: "CSS", value: css },
      ];
    },
  },

  // ---------------- Filter builder ----------------
  {
    id: "css-filter",
    category: "CSS",
    title: "CSS filter builder",
    description: "Combine blur, brightness, contrast, grayscale, hue-rotate, saturation.",
    fields: [
      {
        id: "blur",
        label: "Blur",
        type: "number",
        default: 0,
        min: 0,
        max: 40,
        step: 0.5,
        unit: "px",
      },
      {
        id: "brightness",
        label: "Brightness",
        type: "number",
        default: 100,
        min: 0,
        max: 300,
        unit: "%",
      },
      {
        id: "contrast",
        label: "Contrast",
        type: "number",
        default: 100,
        min: 0,
        max: 300,
        unit: "%",
      },
      {
        id: "grayscale",
        label: "Grayscale",
        type: "number",
        default: 0,
        min: 0,
        max: 100,
        unit: "%",
      },
      { id: "hue", label: "Hue rotate", type: "number", default: 0, min: 0, max: 360, unit: "deg" },
      {
        id: "saturate",
        label: "Saturate",
        type: "number",
        default: 100,
        min: 0,
        max: 300,
        unit: "%",
      },
      { id: "invert", label: "Invert", type: "number", default: 0, min: 0, max: 100, unit: "%" },
    ],
    compute: (v) => {
      const parts: string[] = [];
      if (n(v.blur) > 0) parts.push(`blur(${n(v.blur)}px)`);
      if (n(v.brightness, 100) !== 100) parts.push(`brightness(${n(v.brightness, 100)}%)`);
      if (n(v.contrast, 100) !== 100) parts.push(`contrast(${n(v.contrast, 100)}%)`);
      if (n(v.grayscale) > 0) parts.push(`grayscale(${n(v.grayscale)}%)`);
      if (n(v.hue) !== 0) parts.push(`hue-rotate(${n(v.hue)}deg)`);
      if (n(v.saturate, 100) !== 100) parts.push(`saturate(${n(v.saturate, 100)}%)`);
      if (n(v.invert) > 0) parts.push(`invert(${n(v.invert)}%)`);
      const filter = parts.join(" ") || "none";
      return [
        {
          label: "Preview",
          value: "",
          preview: {
            style: {
              filter,
              background: "linear-gradient(135deg,#f59e0b,#ef4444,#a855f7,#3b82f6)",
            },
            text: " ",
          },
        },
        { label: "CSS", value: `filter: ${filter};` },
      ];
    },
  },

  // ---------------- Transform ----------------
  {
    id: "css-transform",
    category: "CSS",
    title: "Transform builder",
    description: "Rotate, scale, skew, and translate - combined into one transform.",
    fields: [
      {
        id: "rotate",
        label: "Rotate",
        type: "number",
        default: 0,
        min: -360,
        max: 360,
        unit: "deg",
      },
      { id: "scale", label: "Scale", type: "number", default: 1, min: 0, max: 3, step: 0.05 },
      { id: "skewX", label: "Skew X", type: "number", default: 0, min: -60, max: 60, unit: "deg" },
      { id: "skewY", label: "Skew Y", type: "number", default: 0, min: -60, max: 60, unit: "deg" },
      {
        id: "tx",
        label: "Translate X",
        type: "number",
        default: 0,
        min: -200,
        max: 200,
        unit: "px",
      },
      {
        id: "ty",
        label: "Translate Y",
        type: "number",
        default: 0,
        min: -200,
        max: 200,
        unit: "px",
      },
    ],
    compute: (v) => {
      const transform = `translate(${n(v.tx)}px, ${n(v.ty)}px) rotate(${n(v.rotate)}deg) scale(${n(v.scale, 1)}) skew(${n(v.skewX)}deg, ${n(v.skewY)}deg)`;
      return [
        {
          label: "Preview",
          value: "",
          preview: {
            style: {
              transform,
              background: "linear-gradient(135deg,#3b82f6,#a855f7)",
              borderRadius: "12px",
            },
            text: " ",
            bg: "#f5f5f5",
          },
        },
        { label: "CSS", value: `transform: ${transform};` },
      ];
    },
  },

  // ---------------- Clip-path ----------------
  {
    id: "css-clip-path",
    category: "CSS",
    title: "Clip-path shapes",
    description:
      "Preset clip-path shapes: circle, ellipse, triangle, hexagon, star, arrow, chevron.",
    fields: [
      {
        id: "shape",
        label: "Shape",
        type: "select",
        default: "hexagon",
        options: [
          { value: "circle", label: "Circle" },
          { value: "ellipse", label: "Ellipse" },
          { value: "triangle", label: "Triangle" },
          { value: "rhombus", label: "Rhombus" },
          { value: "pentagon", label: "Pentagon" },
          { value: "hexagon", label: "Hexagon" },
          { value: "octagon", label: "Octagon" },
          { value: "star", label: "Star" },
          { value: "arrow", label: "Arrow (right)" },
          { value: "chevron", label: "Chevron" },
          { value: "message", label: "Message bubble" },
        ],
      },
    ],
    compute: (v) => {
      const shapes: Record<string, string> = {
        circle: "circle(50% at 50% 50%)",
        ellipse: "ellipse(50% 35% at 50% 50%)",
        triangle: "polygon(50% 0%, 0% 100%, 100% 100%)",
        rhombus: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        pentagon: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
        hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
        octagon: "polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)",
        star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
        arrow: "polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%)",
        chevron: "polygon(75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%, 0% 0%)",
        message: "polygon(0% 0%, 100% 0%, 100% 75%, 75% 75%, 75% 100%, 50% 75%, 0% 75%)",
      };
      const clip = shapes[v.shape] ?? shapes.hexagon;
      return [
        {
          label: "Preview",
          value: "",
          preview: {
            style: { clipPath: clip, background: "linear-gradient(135deg,#3b82f6,#a855f7)" },
            text: " ",
            bg: "#f5f5f5",
          },
        },
        { label: "CSS", value: `clip-path: ${clip};` },
      ];
    },
  },

  // ---------------- Flexbox playground ----------------
  {
    id: "css-flexbox",
    category: "CSS",
    title: "Flexbox playground",
    description: "Visualize flex-direction, justify-content, align-items, wrap, and gap.",
    fields: [
      {
        id: "direction",
        label: "flex-direction",
        type: "select",
        default: "row",
        options: ["row", "row-reverse", "column", "column-reverse"].map((x) => ({
          value: x,
          label: x,
        })),
      },
      {
        id: "justify",
        label: "justify-content",
        type: "select",
        default: "flex-start",
        options: [
          "flex-start",
          "flex-end",
          "center",
          "space-between",
          "space-around",
          "space-evenly",
        ].map((x) => ({ value: x, label: x })),
      },
      {
        id: "align",
        label: "align-items",
        type: "select",
        default: "stretch",
        options: ["stretch", "flex-start", "flex-end", "center", "baseline"].map((x) => ({
          value: x,
          label: x,
        })),
      },
      {
        id: "wrap",
        label: "flex-wrap",
        type: "select",
        default: "nowrap",
        options: ["nowrap", "wrap", "wrap-reverse"].map((x) => ({ value: x, label: x })),
      },
      { id: "gap", label: "gap", type: "number", default: 8, min: 0, max: 60, unit: "px" },
      { id: "items", label: "Number of items", type: "number", default: 4, min: 1, max: 12 },
    ],
    compute: (v) => {
      const style: Record<string, string> = {
        display: "flex",
        flexDirection: v.direction,
        justifyContent: v.justify,
        alignItems: v.align,
        flexWrap: v.wrap,
        gap: `${n(v.gap)}px`,
        background: "#f5f5f5",
        padding: "12px",
      };
      const css = `display: flex;\nflex-direction: ${v.direction};\njustify-content: ${v.justify};\nalign-items: ${v.align};\nflex-wrap: ${v.wrap};\ngap: ${n(v.gap)}px;`;
      return [
        {
          label: "Preview",
          value: "",
          preview: { style, children: Math.max(1, Math.min(12, n(v.items, 4))) },
        },
        { label: "CSS", value: css },
      ];
    },
  },

  // ---------------- Grid playground ----------------
  {
    id: "css-grid",
    category: "CSS",
    title: "CSS Grid playground",
    description: "Configure columns, rows, and gap with a live grid preview.",
    fields: [
      { id: "cols", label: "Columns", type: "number", default: 3, min: 1, max: 12 },
      { id: "rows", label: "Rows", type: "number", default: 2, min: 1, max: 8 },
      { id: "gap", label: "Gap", type: "number", default: 8, min: 0, max: 60, unit: "px" },
      {
        id: "template",
        label: "Column template",
        type: "select",
        default: "equal",
        options: [
          { value: "equal", label: "Equal (1fr repeated)" },
          { value: "auto", label: "Auto-fit minmax" },
          { value: "sidebar", label: "Sidebar (240px 1fr)" },
        ],
      },
    ],
    compute: (v) => {
      const cols = Math.max(1, Math.min(12, n(v.cols, 3)));
      const rows = Math.max(1, Math.min(8, n(v.rows, 2)));
      let template: string;
      if (v.template === "auto") template = "repeat(auto-fit, minmax(120px, 1fr))";
      else if (v.template === "sidebar") template = "240px 1fr";
      else template = `repeat(${cols}, 1fr)`;
      const style: Record<string, string> = {
        display: "grid",
        gridTemplateColumns: template,
        gap: `${n(v.gap)}px`,
        background: "#f5f5f5",
        padding: "12px",
      };
      const css = `display: grid;\ngrid-template-columns: ${template};\ngap: ${n(v.gap)}px;`;
      return [
        { label: "Preview", value: "", preview: { style, children: cols * rows } },
        { label: "CSS", value: css },
      ];
    },
  },

  // ---------------- Aspect ratio ----------------
  {
    id: "css-aspect-ratio",
    category: "CSS",
    title: "Aspect-ratio box",
    description: "Preview any aspect ratio with matching CSS.",
    fields: [
      { id: "w", label: "Width ratio", type: "number", default: 16, min: 1, max: 100 },
      { id: "h", label: "Height ratio", type: "number", default: 9, min: 1, max: 100 },
    ],
    compute: (v) => {
      const w = n(v.w, 16),
        h = n(v.h, 9);
      const style: Record<string, string> = {
        aspectRatio: `${w} / ${h}`,
        background: "linear-gradient(135deg,#3b82f6,#a855f7)",
        borderRadius: "8px",
        width: "100%",
      };
      return [
        {
          label: "Preview",
          value: `${w} : ${h}`,
          preview: { style, text: `${w}:${h}`, bg: "#f5f5f5" },
        },
        { label: "CSS", value: `aspect-ratio: ${w} / ${h};` },
        { label: "Decimal", value: (w / h).toFixed(4) },
      ];
    },
  },

  // ---------------- Cubic-bezier presets ----------------
  {
    id: "css-easing",
    category: "CSS",
    title: "Easing / cubic-bezier presets",
    description: "Pick a Penner-style easing curve and copy its cubic-bezier.",
    fields: [
      {
        id: "easing",
        label: "Curve",
        type: "select",
        default: "easeInOut",
        options: [
          { value: "linear", label: "Linear" },
          { value: "ease", label: "ease" },
          { value: "easeIn", label: "easeIn (quad)" },
          { value: "easeOut", label: "easeOut (quad)" },
          { value: "easeInOut", label: "easeInOut (quad)" },
          { value: "easeInCubic", label: "easeIn (cubic)" },
          { value: "easeOutCubic", label: "easeOut (cubic)" },
          { value: "easeInOutCubic", label: "easeInOut (cubic)" },
          { value: "easeInQuart", label: "easeIn (quart)" },
          { value: "easeOutQuart", label: "easeOut (quart)" },
          { value: "easeInExpo", label: "easeIn (expo)" },
          { value: "easeOutExpo", label: "easeOut (expo)" },
          { value: "easeInBack", label: "easeIn (back)" },
          { value: "easeOutBack", label: "easeOut (back)" },
          { value: "easeInOutBack", label: "easeInOut (back)" },
        ],
      },
    ],
    compute: (v) => {
      const map: Record<string, string> = {
        linear: "cubic-bezier(0, 0, 1, 1)",
        ease: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        easeIn: "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
        easeOut: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        easeInOut: "cubic-bezier(0.455, 0.03, 0.515, 0.955)",
        easeInCubic: "cubic-bezier(0.55, 0.055, 0.675, 0.19)",
        easeOutCubic: "cubic-bezier(0.215, 0.61, 0.355, 1)",
        easeInOutCubic: "cubic-bezier(0.645, 0.045, 0.355, 1)",
        easeInQuart: "cubic-bezier(0.895, 0.03, 0.685, 0.22)",
        easeOutQuart: "cubic-bezier(0.165, 0.84, 0.44, 1)",
        easeInExpo: "cubic-bezier(0.95, 0.05, 0.795, 0.035)",
        easeOutExpo: "cubic-bezier(0.19, 1, 0.22, 1)",
        easeInBack: "cubic-bezier(0.6, -0.28, 0.735, 0.045)",
        easeOutBack: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        easeInOutBack: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
      };
      const curve = map[v.easing] ?? map.easeInOut;
      return [
        { label: "cubic-bezier", value: curve },
        { label: "transition-timing-function", value: `transition-timing-function: ${curve};` },
        { label: "Full transition", value: `transition: all 400ms ${curve};` },
      ];
    },
  },
];
