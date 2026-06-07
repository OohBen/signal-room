import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: resolve(projectRoot, "../.."),
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
