import type { NextConfig } from "next";

// Unity's Brotli builds name their files *.wasm.unityweb, *.framework.js.unityweb and *.data.unityweb. Saying they
// are Brotli lets the browser decompress them natively (the JavaScript fallback is far slower); the content type is
// that of the file underneath. tools/serve.ps1 does the same for local testing.
const unityWeb = (underlying: string, contentType: string) => ({
  source: `/templates/:dir/Build/:file(.*\\.${underlying}\\.unityweb)`,
  headers: [
    { key: "Content-Encoding", value: "br" },
    { key: "Content-Type", value: contentType },
  ],
});

// On every route: only this site may put its pages in a frame, and browsers must not guess content types.
const everyRoute = {
  source: "/:path*",
  headers: [
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
  ],
};

// The Unity player may fetch only from this site (the settings file, the models, its own files): a page link such as
// /templates/runner-desktop/index.html?settings=https://elsewhere.example/x.json then cannot make it load content from
// anywhere else. Where two rules set the same header the later one wins, so this stays after everyRoute and repeats
// its frame-ancestors. blob: and data: are for the player's own use and reach no other site.
const templatePages = {
  source: "/templates/:path*",
  headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'; connect-src 'self' blob: data:" }],
};

const nextConfig: NextConfig = {
  async headers() {
    return [
      unityWeb("wasm", "application/wasm"),
      unityWeb("framework\\.js", "application/javascript"),
      unityWeb("data", "application/octet-stream"),
      everyRoute,
      templatePages,
    ];
  },
};

export default nextConfig;
