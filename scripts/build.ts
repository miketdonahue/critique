import { $ } from "bun";

// Build both frontend bundles: the injected SDK and the browser chrome.
await $`vite build -c vite.config.sdk.ts`;
await $`vite build -c vite.config.chrome.ts`;

console.log("\ncritique: built dist/sdk/sdk.js and dist/chrome/");
