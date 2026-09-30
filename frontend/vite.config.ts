import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf("node_modules") === -1) return;
          if (id.indexOf("jspdf") !== -1) return "pdf-engine";
          if (id.indexOf("html2canvas") !== -1) return "pdf-renderer";
          if (id.indexOf("framer-motion") !== -1 || id.indexOf("motion-dom") !== -1 || id.indexOf("motion-utils") !== -1) return "motion";
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id.replace(/\\/g, "/"))) return "react-vendor";
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
});
