// scripts/copy-og-assets.cjs
const { cp, mkdir } = require("node:fs/promises");
const { resolve } = require("node:path");

const src = resolve("node_modules/@openglobus/og/res");
const dst = resolve("public/og-res");

(async () => {
  try {
    await mkdir(dst, { recursive: true });
    await cp(src, dst, { recursive: true });
    console.log("[openglobus] Copied assets to /public/og-res");
  } catch (err) {
    console.error("[openglobus] Failed to copy assets:", err.message);
  }
})();
