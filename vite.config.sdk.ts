import { defineConfig } from "vite";
import { resolve } from "node:path";

// Builds the injected artifact SDK as a single self-executing script (dist/sdk/sdk.js).
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, "dist/sdk"),
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: resolve(import.meta.dirname, "src/sdk/index.ts"),
      formats: ["iife"],
      name: "CritiqueSdk",
      fileName: () => "sdk.js",
    },
  },
});
