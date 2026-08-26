import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const html = await readFile(new URL("../web/dist/index.html", import.meta.url), "utf8");
const match = html.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/);
if (!match) throw new Error("Could not find the main Vite bundle");
const bundleUrl = new URL(`../web/dist${match[1]}`, import.meta.url);
const bundle = await readFile(bundleUrl);
const minifiedBytes = (await stat(bundleUrl)).size;
const gzipBytes = gzipSync(bundle).byteLength;
const limits = { minified: 450 * 1024, gzip: 140 * 1024 };

console.log(`main bundle: ${(minifiedBytes / 1024).toFixed(1)} KB minified / ${(gzipBytes / 1024).toFixed(1)} KB gzip`);
if (minifiedBytes > limits.minified || gzipBytes > limits.gzip) {
  throw new Error("Web main bundle exceeds the optimization budget");
}
