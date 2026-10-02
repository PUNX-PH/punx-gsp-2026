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

const nextConfig: NextConfig = {
  async headers() {
    return [
      unityWeb("wasm", "application/wasm"),
      unityWeb("framework\\.js", "application/javascript"),
      unityWeb("data", "application/octet-stream"),
    ];
  },
};

export default nextConfig;
