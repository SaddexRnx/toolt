import { families, type Family } from "./converters";
import { calculators, type Calculator } from "./calculators";

export type CatalogTool = {
  id: string;
  kind: "family" | "calculator";
  title: string;
  description: string;
  category: string;
  /** Input formats, used for search and tool-page chips. */
  inputs: string[];
  /** Output formats, used for search and tool-page chips. */
  outputs: string[];
  /** Lowercase haystack for palette/search matching. */
  keywords: string;
  family?: Family;
  calculator?: Calculator;
};

function fromFamily(f: Family): CatalogTool {
  const inputs = Array.from(new Set(f.inputExts));
  const outputs =
    f.mode === "per-file" ? Array.from(new Set(f.outputs.map((o) => o.ext))) : [f.outputExt];
  return {
    id: f.id,
    kind: "family",
    title: f.title,
    description: f.description,
    category: f.category,
    inputs,
    outputs,
    keywords: [f.title, f.description, f.category, ...inputs, ...outputs]
      .join(" ")
      .toLowerCase(),
    family: f,
  };
}

function fromCalculator(c: Calculator): CatalogTool {
  return {
    id: c.id,
    kind: "calculator",
    title: c.title,
    description: c.description,
    category: c.category,
    inputs: [],
    outputs: [],
    keywords: [c.title, c.description, c.category].join(" ").toLowerCase(),
    calculator: c,
  };
}

// Families first so a family always wins if an id is ever reused.
export const catalog: CatalogTool[] = [
  ...families.map(fromFamily),
  ...calculators.map(fromCalculator),
];

const catalogById = new Map(catalog.map((tool) => [tool.id, tool]));

export function toolById(id: string | undefined): CatalogTool | null {
  if (!id) return null;
  return catalogById.get(id) ?? null;
}

export function relatedTools(tool: CatalogTool, limit = 6): CatalogTool[] {
  return catalog.filter((t) => t.id !== tool.id && t.category === tool.category).slice(0, limit);
}
