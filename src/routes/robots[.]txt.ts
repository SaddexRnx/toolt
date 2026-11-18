import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { siteUrl } from "@/lib/site";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const body = [
          "User-agent: *",
          "Allow: /",
          "",
          `Sitemap: ${siteUrl("/sitemap.xml")}`,
          "",
        ].join("\n");

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
