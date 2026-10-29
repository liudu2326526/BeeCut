import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
    rollupOptions: { input: { editor: "index.html", audioHost: "audio-host.html" } },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    allowedHosts: ["terminal.local", "localhost"],
    proxy: Object.fromEntries(["/api", "/media", "/thumbnails", "/exports"].map(path => [path, "http://127.0.0.1:4318"])),
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
