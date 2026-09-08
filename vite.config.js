import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { sites } from "@openai/sites-vite-plugin";
export default defineConfig({
  plugins: [tailwindcss(), sites()],
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    target: "es2022",
    rollupOptions: {
      onwarn(warning, warn) {
        // Radix and Sonner also support RSC; this Vite app is entirely client rendered.
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes("use client")
        )
          return;
        warn(warning);
      },
    },
  },
  server: { host: "127.0.0.1" },
});
