import { build } from "vite";
import { build as bundle } from "esbuild";
import fs from "node:fs/promises";
await build({ build: { outDir: "dist/client" } });
await bundle({
  entryPoints: ["cloud/index.js"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  target: "es2022",
  outfile: "dist/server/index.js",
  external: ["node:*", "stream"],
  conditions: ["workerd", "worker", "browser"],
  banner: {
    js: "import * as nodeStream from 'node:stream'; import {Buffer} from 'node:buffer'; const require = id => { if(id === 'stream') return nodeStream; throw new Error('Unsupported module: '+id); };",
  },
  minify: true,
});
// Sites owns resource names; this file describes runtime compatibility only.
await fs.writeFile(
  "dist/server/wrangler.json",
  JSON.stringify({
    main: "index.js",
    compatibility_date: "2026-09-08",
    compatibility_flags: ["nodejs_compat"],
    assets: {
      directory: "../client",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*", "/_migration/*"],
    },
  }),
);
