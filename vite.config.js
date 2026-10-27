// Build Tooling (Module B, Month 1 Week 1)
//
// @crxjs/vite-plugin reads manifest.json, resolves the background
// service worker / side panel / (future) content scripts it points to as
// real entry points, and rewrites the paths in the built manifest to the
// hashed output files - so `npm run build` produces a `dist/` folder
// that's a load-unpacked-ready Chrome extension.
//
// This is also what makes it possible to `import "@xenova/transformers"`
// directly inside src/nlu/zero-shot-classifier.js and
// src/matching/embedding-matcher.js: Vite bundles the npm package (and
// its WASM/ONNX runtime assets) into the service worker output instead of
// relying on a raw, unbundled ES import that the browser couldn't resolve.

import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // No custom server/hmr block: @crxjs/vite-plugin injects its own HMR
  // client into the extension's pages and manages that websocket itself.
  // Pinning server.hmr.port here fought with Vite's automatic port
  // fallback (when 5173 was already taken) and crashed the dev server
  // with ERR_SERVER_ALREADY_LISTEN. Leaving this unset lets Vite pick a
  // free port on its own.
});
