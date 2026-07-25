<div align="center">

# To_olT

**The Swiss Army knife for files — 100% in your browser.**

Convert · compress · merge · split · extract · format · hash · scan · generate.
PDFs · images · video · audio · documents · data · code · config · colors · CSS.

*No accounts. No uploads. No tracking. No limits.*

<p>
  <img alt="License" src="https://img.shields.io/badge/license-MIT-black?style=for-the-badge" />
  <img alt="Built with" src="https://img.shields.io/badge/built%20with-open%20source-22c55e?style=for-the-badge" />
  <img alt="Runs" src="https://img.shields.io/badge/runs-in%20browser-black?style=for-the-badge" />
  <img alt="Privacy" src="https://img.shields.io/badge/privacy-local%20only-22c55e?style=for-the-badge" />
</p>

<p>
  <a href="https://t.me/Saddex_x"><img alt="Telegram" src="https://img.shields.io/badge/Telegram-@Saddex__x-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" /></a>
  <a href="https://github.com/"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-follow-181717?style=for-the-badge&logo=github&logoColor=white" /></a>
  <a href="https://toolt.lovable.app"><img alt="Live" src="https://img.shields.io/badge/Live-toolt.lovable.app-22c55e?style=for-the-badge" /></a>
</p>

</div>

---

## Table of contents

- [What is To_olT?](#what-is-to_olt)
- [Highlights](#highlights)
- [Tool catalog](#tool-catalog)
- [Tech stack](#tech-stack)
- [Local development](#local-development)
- [Project structure](#project-structure)
- [Performance & lazy loading](#performance--lazy-loading)
- [Accessibility & i18n](#accessibility--i18n)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Contact](#contact)
- [License & credits](#license--credits)

## What is To_olT?

To_olT is an **all-in-one file toolbox** that runs entirely in the browser.
It replaces dozens of single-purpose sites (PDF splitters, image converters,
JSON formatters, unit calculators, color pickers, CSS builders…) with one
fast, minimal, black-and-white interface.

Every conversion happens **locally on your device** using WebAssembly and
open-source JavaScript libraries. Your files never leave the browser.

## Highlights

- **200+ tools** across 12+ categories — converters, calculators, generators, formatters, builders.
- **Smart Drop** — drop any file, To_olT detects the type and lists every matching tool.
- **Batch mode** — process dozens of files at once with per-file retry, preview, and rename.
- **ZIP export** — bundle results as flat archive or per-input subfolders.
- **Live previews** — thumbnails for images and PDFs before you convert.
- **Local history** (IndexedDB) — re-download or re-run past conversions.
- **21 languages** — English, Spanish, French, German, Italian, Portuguese, Dutch, Swedish, Polish, Czech, Ukrainian, Russian, Turkish, Arabic (RTL), Hebrew (RTL), Hindi, Indonesian, Vietnamese, Chinese, Japanese, Korean.
- **Light & dark theme** — solid palette (no gradients), with a green brand accent and no-flash pre-hydration.
- **Fully responsive** — desktop, tablet, and mobile.
- **Zero telemetry** — no analytics, no tracking, no accounts.
- **Lazy-loaded engines** — heavy libraries (FFmpeg, Tesseract, background removal) only download when you actually use them.

## Tool catalog

### PDF
Merge · split · compress · rotate · reorder · watermark · extract text · extract images ·
PDF → images · images → PDF · PDF → Word (DOCX) · N-up · page range · encrypt · decrypt · sign metadata.

### Images
PNG · JPG · WEBP · AVIF · BMP · TIFF · GIF · HEIC · ICO · SVG.
Convert · compress · resize · crop · rotate · EXIF strip · EXIF viewer · favicon pack · color pick · SVG minify.

### Video & Audio (FFmpeg WASM)
MP4 · WEBM · MOV · MKV · AVI · GIF · MP3 · WAV · OGG · FLAC · AAC · M4A.
Convert · compress · mute · trim · video → GIF · extract audio.

### Documents & Data
DOCX · TXT · MD · HTML · CSV · TSV · JSON · YAML · TOML · XML · XLSX.
Convert · merge · deduplicate · SQL format · JSON Schema generator.

### AI (opt-in, lazy-loaded)
OCR (Tesseract) · background removal (@imgly) · image upscaling.

### Encoders & Hashes
Base64 · Base32 · Hex · URL · HTML entities · JWT decode ·
MD5 · SHA-1/256/384/512 · UUID · nanoid · QR codes · barcodes.

### Text & Code
Case converter · Morse · ROT13 · text stats · lorem ipsum · slugify · diff ·
Markdown → HTML · HTML minify · SVG minify · regex tester.

### Developer
JSON diff · JSON → interface · CSS/HTML formatters & minifiers ·
YAML ↔ JSON ↔ TOML · cron explainer · secrets scanner · password strength.

### Interactive (no files)
BMI · calorie/macro · mortgage · VAT · unit converters · statistics · fuel cost ·
color converter · palette generator · contrast checker · gradient builder ·
box-shadow · button · flexbox · grid · border-radius · typography builders.

## Tech stack

- **[TanStack Start](https://tanstack.com/start)** v1 · **React 19** · **Vite 7**
- **Tailwind CSS v4** (native CSS `@theme` tokens)
- **shadcn/ui** primitives
- **[pdf-lib](https://github.com/Hopding/pdf-lib)** · **[pdf.js](https://github.com/mozilla/pdf.js)** · **[docx](https://github.com/dolanmiu/docx)**
- **[SheetJS](https://github.com/SheetJS/sheetjs)** · **[Papa Parse](https://github.com/mholt/PapaParse)** · **[js-yaml](https://github.com/nodeca/js-yaml)** · **[iarna/toml](https://github.com/iarna/iarna-toml)**
- **[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)** · **[tesseract.js](https://github.com/naptha/tesseract.js)** · **[@imgly/background-removal](https://github.com/imgly/background-removal-js)**
- **[JSZip](https://github.com/Stuk/jszip)** · **[browser-image-compression](https://github.com/Donaldcwl/browser-image-compression)** · **[mammoth](https://github.com/mwilliamson/mammoth.js)**

No API keys. No paid services. No backend.

## Local development

```bash
git clone https://github.com/YOUR_USERNAME/toolt.git
cd toolt
bun install       # or: npm install / pnpm install
bun run dev       # http://localhost:8080
```

Build & preview:

```bash
bun run build
bun run start
```

## Project structure

```
src/
├── routes/                 # TanStack Start file-based routes
│   ├── __root.tsx          # HTML shell + no-flash theme script
│   ├── index.tsx           # Home / catalog
│   ├── pdf-to-word.tsx     # SEO landing page
│   ├── sitemap[.]xml.ts    # /sitemap.xml
│   └── api/…
├── components/
│   ├── SmartDropZone.tsx   # Auto-detect + tool suggestions
│   ├── ConverterDialog.tsx # Batch conversion UI
│   ├── CalculatorDialog.tsx# Interactive tools
│   └── TopBarControls.tsx  # Language + theme switcher
├── lib/
│   ├── converters.ts       # File-based tool registry (~100+ families)
│   ├── calculators.ts      # Interactive tools
│   ├── color-tools.ts
│   ├── css-tools.ts
│   ├── ffmpeg.ts           # Lazy FFmpeg loader + SHA-384 SRI check
│   ├── limits.ts           # Cooldown, concurrency, file-size guards
│   ├── preview.ts          # Thumbnails
│   ├── history.ts          # IndexedDB
│   ├── i18n.tsx            # 21 languages
│   └── theme.tsx           # Light / dark
├── styles.css              # Tailwind v4 tokens + utilities
└── router.tsx
public/
├── robots.txt
├── manifest.webmanifest
└── favicon assets
```

## Performance & lazy loading

To_olT stays fast on low-end devices by loading heavy engines **on demand only**:

| Engine                       | Size    | Loaded when                     |
|------------------------------|---------|---------------------------------|
| `ffmpeg.wasm`                | ~30 MB  | first video/audio conversion    |
| `tesseract.js` + language    | ~15 MB  | first OCR run                   |
| `@imgly/background-removal`  | ~40 MB  | first background-removal run    |
| `pdf.js` worker              | ~1 MB   | first PDF preview/split         |
| `pdf-lib`, `docx`, `xlsx`    | small   | on demand per tool              |

The initial page load ships only the shell, the tool catalog, and Tailwind —
no engines are downloaded until you actually convert something.

## Accessibility & i18n

- Semantic landmarks (`<main>`, `<nav>`, `<footer>`), ARIA labels on all interactive controls.
- Full keyboard navigation with visible focus states.
- Respects `prefers-reduced-motion`.
- **21 languages** with dynamic `<html lang>` and `dir="rtl"` support (Arabic, Hebrew).
- SEO: unique `<title>`, meta description, Open Graph, Twitter cards, JSON-LD, `/sitemap.xml`, `/robots.txt`, `/llms.txt`.

## Security

To_olT has no backend, no database, no accounts, and no telemetry — the
attack surface is intentionally tiny. Still, we harden the client where it
matters:

### CDN integrity (SRI)

FFmpeg's ~30 MB WebAssembly core is fetched from `unpkg.com` at runtime.
Every fetch is verified against a **pinned SHA-384 digest** (`src/lib/ffmpeg.ts`)
before it is handed to the WASM loader — the browser refuses to execute
tampered bytes if unpkg is ever compromised. This is the `fetch()`
equivalent of an HTML `<script integrity>` attribute. To upgrade the pinned
FFmpeg version, regenerate the digests:

```bash
curl -sfL https://unpkg.com/@ffmpeg/core@<version>/dist/umd/ffmpeg-core.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

### Client-side abuse guards (`src/lib/limits.ts`)

There is no server to rate-limit, but a user (or a stuck key, or a bot
open-sourcing the tab) can still crash their own browser. To_olT ships:

- **Per-tool file-size caps** — oversize uploads are rejected up-front
  with a translated, friendly error before any engine spins up.
  Defaults per category (PDF 200 MB, Images 50 MB, Video 500 MB, AI 20 MB…),
  with tighter overrides for the most memory-hungry tools (OCR, background
  removal). Absolute ceiling: 2 GB.
- **Debounce cooldown** on the Convert button (250 ms per tool) that
  absorbs double-clicks and stuck keys.
- **Concurrency limiter** on heavy engines — only one FFmpeg / Tesseract /
  background-removal job runs at a time, even from a bulk queue. Prevents
  memory blow-ups from parallel model loads.

### Input handling

- All conversions happen on your device — files are never uploaded, never
  logged, never sent to a third party.
- Text-input tools (JWT decoder, JSON formatter, URL parser…) validate
  and bound their input on the client.
- No `dangerouslySetInnerHTML` with user content.
- No `eval`, no dynamic `Function()`, no arbitrary code execution.

### Transport & headers

- HTTPS-only in production.
- No third-party trackers, analytics, or ad networks embedded.
- `robots.txt`, `llms.txt`, and `sitemap.xml` are served directly from the
  edge; they do not touch any private data.

### Threat model — what To_olT does **not** protect against

- **Malicious files you choose to open.** A crafted PDF/image could
  exploit a browser or library bug. Use the app only with files you
  trust. Consider running heavy jobs on a spare browser profile.
- **Malicious browser extensions** in your own browser can read anything
  the page can see. To_olT can't defend against that.
- **A compromised device.** Local malware defeats any client-side app.

If you find a vulnerability, please report it privately via Telegram
[@Saddex_x](https://t.me/Saddex_x) before opening a public issue.



## Roadmap

- More AI tools (image captioning, whisper.wasm speech-to-text)
- More PDF editing (redaction, form filling)
- Cloud sync of history via optional user account (opt-in)
- Public tool API for embedding

## Contributing

Pull requests are welcome! For big changes, open an issue first to discuss what
you would like to change. Please keep the design minimal, monochrome (with the
single green brand accent), and 100% client-side — no server-side dependencies.

## Contact

- **Telegram:** [@Saddex_x](https://t.me/Saddex_x)
- **Live app:** [toolt.lovable.app](https://toolt.lovable.app)

## License & credits

Released under the **MIT License**.

Built with love and dozens of amazing open-source libraries. Huge thanks to the
maintainers of pdf-lib, pdf.js, SheetJS, FFmpeg, Tesseract, imgly, TanStack,
Tailwind, shadcn/ui, and every other project that makes To_olT possible.
