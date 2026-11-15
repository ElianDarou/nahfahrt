import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";

/**
 * Puts the stylesheet into index.html. On a cold start the page then needs one request less
 * through the app's local asset server before it can paint. (The CSP allows inline styles.)
 */
function inlineCss(): Plugin {
  return {
    name: "nahfahrt-inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((file) => file.fileName === "index.html");
      if (!html || html.type !== "asset") return;
      let source = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== "asset" || !name.endsWith(".css")) continue;
        const link = new RegExp(`<link rel="stylesheet"[^>]*href="/${name.replace(/[.]/g, "\\.")}"[^>]*>`);
        if (!link.test(source)) continue;
        source = source.replace(link, () => `<style>${String(file.source)}</style>`);
        delete bundle[name];
      }
      html.source = source;
    },
  };
}

export default defineConfig({
  plugins: [preact(), inlineCss()],
  build: { target: "es2020", cssMinify: true, assetsInlineLimit: 0 },
});
