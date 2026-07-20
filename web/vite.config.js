import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load env from the root of the monorepo (one level up from /web)
  const env = loadEnv(mode, "../", "VITE_");
  const apiTarget = env.VITE_API_URL || "http://localhost:3001";

  return {
    plugins: [tailwindcss(), react()],
    server: {
      proxy: {
        "/api": {
          target: apiTarget,
          xfwd: true,
        },
      },
    },
  };
});
