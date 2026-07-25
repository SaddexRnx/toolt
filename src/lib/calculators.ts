// Interactive tools: numeric/text inputs → computed results (no file I/O).

export type CalcField =
  | { id: string; label: string; type: "number"; unit?: string; default?: number; min?: number; max?: number; step?: number; placeholder?: string }
  | { id: string; label: string; type: "select"; options: { value: string; label: string }[]; default?: string }
  | { id: string; label: string; type: "text"; default?: string; placeholder?: string }
  | { id: string; label: string; type: "date"; default?: string }
  | { id: string; label: string; type: "textarea"; default?: string; placeholder?: string };

export type CalcResult = { label: string; value: string; hint?: string };

export type Calculator = {
  id: string;
  category: string;
  title: string;
  description: string;
  fields: CalcField[];
  compute: (values: Record<string, string>) => CalcResult[];
};

const num = (v: string, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const fmt = (n: number, digits = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
    : "—";

export const calculators: Calculator[] = [
  // -------- Health --------
  {
    id: "bmi",
    category: "Health",
    title: "BMI calculator",
    description: "Body Mass Index from height and weight with WHO category.",
    fields: [
      { id: "unit", label: "Units", type: "select", default: "metric", options: [ { value: "metric", label: "Metric (cm/kg)" }, { value: "imperial", label: "Imperial (in/lb)" } ] },
      { id: "height", label: "Height", type: "number", default: 175, min: 50, max: 260, step: 0.1 },
      { id: "weight", label: "Weight", type: "number", default: 70, min: 20, max: 400, step: 0.1 },
    ],
    compute: (v) => {
      const h = num(v.height), w = num(v.weight);
      let bmi: number;
      if (v.unit === "imperial") bmi = (w / (h * h)) * 703;
      else bmi = w / ((h / 100) ** 2);
      let cat = "—";
      if (bmi < 18.5) cat = "Underweight";
      else if (bmi < 25) cat = "Normal weight";
      else if (bmi < 30) cat = "Overweight";
      else if (bmi < 35) cat = "Obese class I";
      else if (bmi < 40) cat = "Obese class II";
      else cat = "Obese class III";
      return [ { label: "BMI", value: fmt(bmi, 1), hint: "kg/m²" }, { label: "Category (WHO)", value: cat } ];
    },
  },
  {
    id: "bmr",
    category: "Health",
    title: "BMR calculator (Mifflin–St Jeor)",
    description: "Basal Metabolic Rate — calories burned at complete rest.",
    fields: [
      { id: "sex", label: "Sex", type: "select", default: "male", options: [ { value: "male", label: "Male" }, { value: "female", label: "Female" } ] },
      { id: "age", label: "Age", type: "number", default: 30, min: 10, max: 120, unit: "years" },
      { id: "height", label: "Height", type: "number", default: 175, min: 100, max: 250, unit: "cm" },
      { id: "weight", label: "Weight", type: "number", default: 70, min: 30, max: 250, unit: "kg" },
    ],
    compute: (v) => {
      const bmr = 10 * num(v.weight) + 6.25 * num(v.height) - 5 * num(v.age) + (v.sex === "male" ? 5 : -161);
      return [ { label: "BMR", value: fmt(bmr, 0), hint: "kcal/day" } ];
    },
  },
  {
    id: "tdee",
    category: "Health",
    title: "Daily calorie needs (TDEE)",
    description: "Total Daily Energy Expenditure with activity multiplier and goal.",
    fields: [
      { id: "sex", label: "Sex", type: "select", default: "male", options: [ { value: "male", label: "Male" }, { value: "female", label: "Female" } ] },
      { id: "age", label: "Age", type: "number", default: 30, min: 10, max: 120 },
      { id: "height", label: "Height (cm)", type: "number", default: 175 },
      { id: "weight", label: "Weight (kg)", type: "number", default: 70 },
      { id: "activity", label: "Activity level", type: "select", default: "1.55", options: [
        { value: "1.2", label: "Sedentary (little exercise)" },
        { value: "1.375", label: "Light (1–3 days/wk)" },
        { value: "1.55", label: "Moderate (3–5 days/wk)" },
        { value: "1.725", label: "Very active (6–7 days/wk)" },
        { value: "1.9", label: "Extreme (2× training)" },
      ] },
      { id: "goal", label: "Goal", type: "select", default: "maintain", options: [
        { value: "cut", label: "Lose weight (−20%)" },
        { value: "maintain", label: "Maintain" },
        { value: "bulk", label: "Gain weight (+15%)" },
      ] },
    ],
    compute: (v) => {
      const bmr = 10 * num(v.weight) + 6.25 * num(v.height) - 5 * num(v.age) + (v.sex === "male" ? 5 : -161);
      const tdee = bmr * num(v.activity, 1);
      const target = v.goal === "cut" ? tdee * 0.8 : v.goal === "bulk" ? tdee * 1.15 : tdee;
      return [
        { label: "BMR", value: fmt(bmr, 0), hint: "kcal/day" },
        { label: "TDEE", value: fmt(tdee, 0), hint: "kcal/day" },
        { label: "Target intake", value: fmt(target, 0), hint: "kcal/day" },
      ];
    },
  },
  {
    id: "macros",
    category: "Health",
    title: "Macro split calculator",
    description: "Split a daily calorie target into protein / carbs / fat grams.",
    fields: [
      { id: "calories", label: "Daily calories", type: "number", default: 2200, min: 800, unit: "kcal" },
      { id: "preset", label: "Ratio", type: "select", default: "balanced", options: [
        { value: "balanced", label: "Balanced (30/40/30)" },
        { value: "lowcarb", label: "Low-carb (35/25/40)" },
        { value: "highprotein", label: "High-protein (40/35/25)" },
        { value: "keto", label: "Keto (25/5/70)" },
      ] },
    ],
    compute: (v) => {
      const cal = num(v.calories);
      const map: Record<string, [number, number, number]> = { balanced:[.30,.40,.30], lowcarb:[.35,.25,.40], highprotein:[.40,.35,.25], keto:[.25,.05,.70] };
      const [p, c, f] = map[v.preset] ?? map.balanced;
      return [
        { label: "Protein", value: fmt((cal * p) / 4, 0), hint: "grams" },
        { label: "Carbs", value: fmt((cal * c) / 4, 0), hint: "grams" },
        { label: "Fat", value: fmt((cal * f) / 9, 0), hint: "grams" },
      ];
    },
  },
  {
    id: "water-intake",
    category: "Health",
    title: "Daily water intake",
    description: "Recommended daily water based on weight and activity.",
    fields: [
      { id: "weight", label: "Weight (kg)", type: "number", default: 70 },
      { id: "activity", label: "Exercise", type: "number", default: 0, unit: "minutes/day" },
    ],
    compute: (v) => {
      const base = num(v.weight) * 0.033;
      const extra = (num(v.activity) / 30) * 0.35;
      const total = base + extra;
      return [
        { label: "Recommended", value: fmt(total, 2), hint: "litres/day" },
        { label: "≈ glasses (250ml)", value: fmt(total / 0.25, 0) },
      ];
    },
  },
  {
    id: "ideal-body-weight",
    category: "Health",
    title: "Ideal body weight",
    description: "Devine formula for estimated ideal weight based on height and sex.",
    fields: [
      { id: "sex", label: "Sex", type: "select", default: "male", options: [ { value: "male", label: "Male" }, { value: "female", label: "Female" } ] },
      { id: "height", label: "Height (cm)", type: "number", default: 175 },
    ],
    compute: (v) => {
      const inchesOver5ft = Math.max(0, num(v.height) / 2.54 - 60);
      const ibw = (v.sex === "male" ? 50 : 45.5) + 2.3 * inchesOver5ft;
      return [ { label: "Ideal weight (Devine)", value: fmt(ibw, 1), hint: "kg" } ];
    },
  },

  // -------- Finance --------
  {
    id: "vat",
    category: "Math",
    title: "VAT calculator",
    description: "Add or remove VAT from a price at a given rate.",
    fields: [
      { id: "amount", label: "Amount", type: "number", default: 100, step: 0.01 },
      { id: "rate", label: "VAT rate (%)", type: "number", default: 20, step: 0.1 },
      { id: "mode", label: "Mode", type: "select", default: "add", options: [ { value: "add", label: "Add VAT (net → gross)" }, { value: "remove", label: "Remove VAT (gross → net)" } ] },
    ],
    compute: (v) => {
      const a = num(v.amount), r = num(v.rate) / 100;
      if (v.mode === "add") {
        const vat = a * r; return [ { label: "Net", value: fmt(a) }, { label: "VAT", value: fmt(vat) }, { label: "Gross", value: fmt(a + vat) } ];
      }
      const net = a / (1 + r); const vat = a - net;
      return [ { label: "Net", value: fmt(net) }, { label: "VAT", value: fmt(vat) }, { label: "Gross", value: fmt(a) } ];
    },
  },
  {
    id: "tip",
    category: "Math",
    title: "Tip calculator",
    description: "Compute the tip amount and per-person share.",
    fields: [
      { id: "bill", label: "Bill amount", type: "number", default: 50, step: 0.01 },
      { id: "tip", label: "Tip (%)", type: "number", default: 15, step: 0.5 },
      { id: "people", label: "Split between (people)", type: "number", default: 1, min: 1 },
    ],
    compute: (v) => {
      const bill = num(v.bill), tip = bill * (num(v.tip) / 100), total = bill + tip;
      const p = Math.max(1, num(v.people, 1));
      return [
        { label: "Tip", value: fmt(tip) },
        { label: "Total", value: fmt(total) },
        { label: "Per person", value: fmt(total / p) },
      ];
    },
  },
  {
    id: "discount",
    category: "Math",
    title: "Discount / sale price",
    description: "Sale price and savings after a percentage discount.",
    fields: [
      { id: "price", label: "Original price", type: "number", default: 100, step: 0.01 },
      { id: "discount", label: "Discount (%)", type: "number", default: 25, step: 0.5 },
    ],
    compute: (v) => {
      const p = num(v.price), d = num(v.discount) / 100;
      return [ { label: "You save", value: fmt(p * d) }, { label: "Sale price", value: fmt(p * (1 - d)) } ];
    },
  },
  {
    id: "percentage",
    category: "Math",
    title: "Percentage calculator",
    description: "What is X% of Y, what percent X is of Y, and percent change A→B.",
    fields: [
      { id: "x", label: "X", type: "number", default: 25 },
      { id: "y", label: "Y", type: "number", default: 200 },
    ],
    compute: (v) => {
      const x = num(v.x), y = num(v.y);
      return [
        { label: `${fmt(x)}% of ${fmt(y)}`, value: fmt((x * y) / 100) },
        { label: `${fmt(x)} is % of ${fmt(y)}`, value: fmt(y === 0 ? 0 : (x / y) * 100) + "%" },
        { label: `Change from ${fmt(x)} → ${fmt(y)}`, value: fmt(x === 0 ? 0 : ((y - x) / x) * 100) + "%" },
      ];
    },
  },
  {
    id: "mortgage",
    category: "Math",
    title: "Mortgage payment",
    description: "Monthly payment, total interest, and total paid over the loan term.",
    fields: [
      { id: "principal", label: "Loan amount", type: "number", default: 300000, step: 1000 },
      { id: "rate", label: "Annual rate (%)", type: "number", default: 5, step: 0.01 },
      { id: "years", label: "Term", type: "number", default: 30, min: 1, max: 50, unit: "years" },
    ],
    compute: (v) => {
      const p = num(v.principal), r = num(v.rate) / 100 / 12, n = num(v.years) * 12;
      const m = r === 0 ? p / n : (p * r) / (1 - Math.pow(1 + r, -n));
      const total = m * n;
      return [
        { label: "Monthly payment", value: fmt(m) },
        { label: "Total paid", value: fmt(total) },
        { label: "Total interest", value: fmt(total - p) },
      ];
    },
  },
  {
    id: "compound-interest",
    category: "Math",
    title: "Compound interest",
    description: "Future value of an initial deposit plus optional monthly contributions.",
    fields: [
      { id: "principal", label: "Initial deposit", type: "number", default: 1000 },
      { id: "monthly", label: "Monthly contribution", type: "number", default: 100 },
      { id: "rate", label: "Annual rate (%)", type: "number", default: 7, step: 0.1 },
      { id: "years", label: "Years", type: "number", default: 20 },
    ],
    compute: (v) => {
      const p = num(v.principal), c = num(v.monthly), r = num(v.rate) / 100 / 12, n = num(v.years) * 12;
      const fvP = p * Math.pow(1 + r, n);
      const fvC = r === 0 ? c * n : c * ((Math.pow(1 + r, n) - 1) / r);
      const total = fvP + fvC;
      const contrib = p + c * n;
      return [
        { label: "Future value", value: fmt(total) },
        { label: "Total contributed", value: fmt(contrib) },
        { label: "Interest earned", value: fmt(total - contrib) },
      ];
    },
  },
  {
    id: "loan-payment",
    category: "Math",
    title: "Loan payment",
    description: "Fixed monthly payment for a general-purpose loan.",
    fields: [
      { id: "principal", label: "Loan amount", type: "number", default: 10000 },
      { id: "rate", label: "Annual rate (%)", type: "number", default: 8, step: 0.01 },
      { id: "months", label: "Term (months)", type: "number", default: 36 },
    ],
    compute: (v) => {
      const p = num(v.principal), r = num(v.rate) / 100 / 12, n = num(v.months);
      const m = r === 0 ? p / n : (p * r) / (1 - Math.pow(1 + r, -n));
      return [ { label: "Monthly payment", value: fmt(m) }, { label: "Total interest", value: fmt(m * n - p) }, { label: "Total paid", value: fmt(m * n) } ];
    },
  },
  {
    id: "hourly-salary",
    category: "Math",
    title: "Hourly ↔ annual salary",
    description: "Convert an hourly wage to annual salary and vice versa.",
    fields: [
      { id: "mode", label: "Mode", type: "select", default: "toAnnual", options: [ { value: "toAnnual", label: "Hourly → annual" }, { value: "toHourly", label: "Annual → hourly" } ] },
      { id: "value", label: "Amount", type: "number", default: 25 },
      { id: "hours", label: "Hours per week", type: "number", default: 40 },
      { id: "weeks", label: "Working weeks per year", type: "number", default: 52 },
    ],
    compute: (v) => {
      const val = num(v.value), h = num(v.hours), w = num(v.weeks);
      if (v.mode === "toAnnual") {
        const annual = val * h * w;
        return [ { label: "Annual", value: fmt(annual) }, { label: "Monthly (÷12)", value: fmt(annual / 12) }, { label: "Weekly", value: fmt(val * h) } ];
      }
      const hourly = val / (h * w);
      return [ { label: "Hourly", value: fmt(hourly) }, { label: "Weekly", value: fmt(hourly * h) }, { label: "Monthly (÷12)", value: fmt(val / 12) } ];
    },
  },

  // -------- Utility --------
  {
    id: "aspect-ratio",
    category: "Math",
    title: "Aspect ratio calculator",
    description: "Compute a missing dimension while preserving an aspect ratio.",
    fields: [
      { id: "w1", label: "Original width", type: "number", default: 1920 },
      { id: "h1", label: "Original height", type: "number", default: 1080 },
      { id: "w2", label: "New width (leave 0 to solve)", type: "number", default: 1280 },
    ],
    compute: (v) => {
      const w1 = num(v.w1), h1 = num(v.h1), w2 = num(v.w2);
      const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
      const g = gcd(w1, h1) || 1;
      const h2 = w1 === 0 ? 0 : (w2 * h1) / w1;
      return [
        { label: "Aspect ratio", value: `${w1 / g} : ${h1 / g}` },
        { label: "New height", value: fmt(h2, 2) },
        { label: "Decimal ratio", value: fmt(w1 / (h1 || 1), 4) },
      ];
    },
  },
  {
    id: "business-days",
    category: "Math",
    title: "Business days between dates",
    description: "Count weekdays (Mon–Fri) between two dates, inclusive.",
    fields: [
      { id: "start", label: "Start date", type: "date", default: new Date().toISOString().slice(0, 10) },
      { id: "end", label: "End date", type: "date", default: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) },
    ],
    compute: (v) => {
      const s = new Date(v.start), e = new Date(v.end);
      if (isNaN(+s) || isNaN(+e)) return [ { label: "Error", value: "Invalid date" } ];
      const [a, b] = s <= e ? [s, e] : [e, s];
      let days = 0, biz = 0;
      for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) { days++; const dow = d.getDay(); if (dow !== 0 && dow !== 6) biz++; }
      return [ { label: "Calendar days", value: fmt(days, 0) }, { label: "Weekdays (Mon–Fri)", value: fmt(biz, 0) }, { label: "Weekend days", value: fmt(days - biz, 0) } ];
    },
  },
  {
    id: "age",
    category: "Math",
    title: "Age calculator",
    description: "Age in years, months, and days from a birthdate.",
    fields: [
      { id: "birth", label: "Date of birth", type: "date", default: "1990-01-01" },
      { id: "target", label: "As of date", type: "date", default: new Date().toISOString().slice(0, 10) },
    ],
    compute: (v) => {
      const b = new Date(v.birth), t = new Date(v.target);
      if (isNaN(+b) || isNaN(+t)) return [ { label: "Error", value: "Invalid date" } ];
      let years = t.getFullYear() - b.getFullYear();
      let months = t.getMonth() - b.getMonth();
      let days = t.getDate() - b.getDate();
      if (days < 0) { months--; days += new Date(t.getFullYear(), t.getMonth(), 0).getDate(); }
      if (months < 0) { years--; months += 12; }
      const totalDays = Math.floor((+t - +b) / 86400000);
      return [
        { label: "Age", value: `${years}y ${months}m ${days}d` },
        { label: "Total days", value: fmt(totalDays, 0) },
        { label: "Total months", value: fmt(years * 12 + months, 0) },
      ];
    },
  },
  {
    id: "statistics",
    category: "Math",
    title: "Statistics calculator",
    description: "Mean, median, mode, min, max, variance, standard deviation.",
    fields: [
      { id: "data", label: "Numbers (comma or newline separated)", type: "textarea", default: "10, 12, 15, 18, 20, 22, 22, 25, 30" },
    ],
    compute: (v) => {
      const arr = v.data.split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n));
      if (!arr.length) return [ { label: "Error", value: "No valid numbers" } ];
      const n = arr.length;
      const sum = arr.reduce((a, b) => a + b, 0);
      const mean = sum / n;
      const sorted = [...arr].sort((a, b) => a - b);
      const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      const counts = new Map<number, number>();
      arr.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
      let maxC = 0; const modes: number[] = [];
      counts.forEach((c, val) => { if (c > maxC) { maxC = c; modes.length = 0; modes.push(val); } else if (c === maxC) modes.push(val); });
      const variance = arr.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
      return [
        { label: "Count", value: fmt(n, 0) }, { label: "Sum", value: fmt(sum) },
        { label: "Mean", value: fmt(mean, 4) }, { label: "Median", value: fmt(median, 4) },
        { label: "Mode", value: modes.length === n ? "no mode" : modes.join(", ") },
        { label: "Min", value: fmt(sorted[0]) }, { label: "Max", value: fmt(sorted[n - 1]) },
        { label: "Variance", value: fmt(variance, 4) }, { label: "Std deviation", value: fmt(Math.sqrt(variance), 4) },
      ];
    },
  },
  {
    id: "fuel-cost",
    category: "Math",
    title: "Fuel cost calculator",
    description: "Estimate total fuel cost for a trip.",
    fields: [
      { id: "distance", label: "Distance (km)", type: "number", default: 500 },
      { id: "consumption", label: "Consumption (L/100km)", type: "number", default: 7 },
      { id: "price", label: "Fuel price per litre", type: "number", default: 1.65, step: 0.01 },
    ],
    compute: (v) => {
      const litres = (num(v.distance) * num(v.consumption)) / 100;
      const cost = litres * num(v.price);
      return [ { label: "Fuel used", value: fmt(litres, 2), hint: "litres" }, { label: "Total cost", value: fmt(cost) } ];
    },
  },
  {
    id: "subnet",
    category: "Math",
    title: "Subnet (CIDR) calculator",
    description: "Network, broadcast, usable range, and host count from CIDR notation.",
    fields: [
      { id: "cidr", label: "CIDR", type: "text", default: "192.168.1.0/24", placeholder: "e.g. 10.0.0.0/16" },
    ],
    compute: (v) => {
      const m = v.cidr.trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
      if (!m) return [ { label: "Error", value: "Format: A.B.C.D/mask" } ];
      const parts = [+m[1], +m[2], +m[3], +m[4]]; const mask = +m[5];
      if (parts.some((p) => p < 0 || p > 255) || mask < 0 || mask > 32) return [ { label: "Error", value: "Invalid IP or mask" } ];
      const ip = (parts[0] << 24 >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
      const maskBits = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
      const network = (ip & maskBits) >>> 0;
      const broadcast = (network | (~maskBits >>> 0)) >>> 0;
      const toIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
      const hosts = mask >= 31 ? 0 : (broadcast - network - 1);
      return [
        { label: "Network", value: toIp(network) },
        { label: "Broadcast", value: toIp(broadcast) },
        { label: "Subnet mask", value: toIp(maskBits) },
        { label: "First host", value: mask >= 31 ? "—" : toIp(network + 1) },
        { label: "Last host", value: mask >= 31 ? "—" : toIp(broadcast - 1) },
        { label: "Usable hosts", value: fmt(hosts, 0) },
      ];
    },
  },
];

export type CalcGroup = { title: string; items: Calculator[] };
export const calculatorGroups: CalcGroup[] = Array.from(
  calculators.reduce((map, c) => {
    const arr = map.get(c.category) ?? [];
    arr.push(c);
    map.set(c.category, arr);
    return map;
  }, new Map<string, Calculator[]>()),
).map(([title, items]) => ({ title, items }));
