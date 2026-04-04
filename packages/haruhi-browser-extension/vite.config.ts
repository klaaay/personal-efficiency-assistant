import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-extension-files",
      closeBundle() {
        // 复制 manifest.json
        copyFileSync(
          resolve(__dirname, "manifest.json"),
          resolve(__dirname, "dist/manifest.json")
        );
        console.log("✓ Copied manifest.json to dist/");

        // 复制 icons
        const iconsDir = resolve(__dirname, "dist/icons");
        mkdirSync(iconsDir, { recursive: true });

        ["icon-16.png", "icon-48.png", "icon-128.png"].forEach((icon) => {
          copyFileSync(
            resolve(__dirname, "src/assets/icons", icon),
            resolve(__dirname, "dist/icons", icon)
          );
        });
        console.log("✓ Copied icons to dist/");
      },
    },
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        settings: resolve(__dirname, "settings.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].[hash].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
});
