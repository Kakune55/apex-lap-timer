import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  build: {
    outDir: "public",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("react-leaflet") || id.includes("leaflet")) {
            return "vendor-maps";
          }

          if (id.includes("recharts")) {
            return "vendor-charts";
          }

          if (id.includes("motion")) {
            return "vendor-motion";
          }

          if (
            id.includes("react") ||
            id.includes("scheduler") ||
            id.includes("lucide-react")
          ) {
            return "vendor-core";
          }
        },
      },
    },
  },
});
