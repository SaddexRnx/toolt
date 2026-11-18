import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { I18nProvider } from "../lib/i18n";
import { ThemeProvider } from "../lib/theme";
import { CommandPalette } from "../components/CommandPalette";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#000000" },
      { title: "To_olT" },
      { name: "description", content: "To_olT - browser-based file tools." },
      { property: "og:site_name", content: "To_olT" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "To_olT - every file tool, in your browser" },
      {
        property: "og:description",
        content:
          "Convert, compress, merge, split, extract, format, hash, scan and generate. All locally in your browser, no uploads.",
      },
      { property: "og:image", content: "/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "To_olT - every file tool, in your browser" },
      {
        name: "twitter:description",
        content:
          "Convert, compress, merge, split, extract, format, hash, scan and generate. All locally in your browser, no uploads.",
      },
      { name: "twitter:image", content: "/og.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png?v=3", type: "image/png" },
      { rel: "shortcut icon", href: "/favicon.png?v=3", type: "image/png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Inline pre-hydration script: apply saved theme + language BEFORE React
// renders so light/dark and dir attributes are already correct on first paint.
// This eliminates the flash and keeps SSR HTML consistent with what the client
// will render after hydration. Dark is the primary theme: new visitors and
// visitors with no explicit choice get dark; only a saved "light" wins.
const NO_FLASH = `(() => { try {
  var t = localStorage.getItem('toolt.theme');
  if (!t) t = 'dark';
  else t = t === 'light' ? 'light' : 'dark';
  if (t === 'dark') document.documentElement.classList.add('dark');
  var l = localStorage.getItem('toolt.lang');
  if (l) { document.documentElement.lang = l; if (l === 'ar' || l === 'he' || l === 'fa') document.documentElement.dir = 'rtl'; }
} catch(e){} })();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Offline shell: registered in production only, after first paint, so it
  // never interferes with the dev server's live modules.
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support is best-effort */
      });
    }, 2000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <CommandPalette />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
