import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import fs from "node:fs";

export default defineConfig(({ mode }) => {
  // Load env from the root of the monorepo (one level up from /web)
  const env = loadEnv(mode, "../", "VITE_");
  const apiTarget = env.VITE_API_URL || "http://localhost:3001";

  const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8"));
  const appVersion = process.env.VITE_APP_VERSION || env.VITE_APP_VERSION || pkg.version || "0.7.0";
  const versionLabel = `v${appVersion.replace(/^v/, "")}`;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
      tailwindcss(),
      react(),
      {
        name: "markdown-negotiation",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const accept = req.headers.accept || "";
            if (accept.includes("text/markdown") && (!req.url || req.url === "/" || req.url.startsWith("/index.html") || !req.url.includes("."))) {
              const mdPath = fileURLToPath(new URL("./public/index.md", import.meta.url));
              if (fs.existsSync(mdPath)) {
                res.setHeader("Content-Type", "text/markdown; charset=utf-8");
                res.setHeader("Vary", "Accept");
                return res.end(fs.readFileSync(mdPath, "utf-8"));
              }
            }
            next();
          });
        },
      },
      {
        name: "html-version-transform",
        transformIndexHtml(html) {
          return html
            .replaceAll("%APP_VERSION%", versionLabel)
            .replaceAll("%APP_RAW_VERSION%", appVersion);
        },
        closeBundle() {
          const swDist = fileURLToPath(new URL("./dist/sw.js", import.meta.url));
          if (fs.existsSync(swDist)) {
            const content = fs.readFileSync(swDist, "utf-8");
            fs.writeFileSync(
              swDist,
              content
                .replaceAll("%APP_VERSION%", versionLabel)
                .replaceAll("%APP_RAW_VERSION%", appVersion)
            );
          }
        },
      },
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: apiTarget,
          xfwd: true,
          ws: true,
        },
      },
    },
  };
});
