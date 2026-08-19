import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Builds the browser chrome (React side-panel app) into dist/chrome.
export default defineConfig({
  root: resolve(import.meta.dirname, "../src/chrome"),
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "../src/chrome") },
  },
  build: {
    outDir: resolve(import.meta.dirname, "../dist/chrome"),
    emptyOutDir: true,
    target: "es2022",
  },
});
