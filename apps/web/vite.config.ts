import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      manifest: {
        name: "DueRadar — bills, subscriptions and trials",
        short_name: "DueRadar",
        description:
          "Track bills, subscriptions and free trials in Ghana. GHS by default, reminders before every due date.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#f6f5f1",
        theme_color: "#0b3b36",
        lang: "en-GH",
        dir: "ltr",
        categories: ["finance", "productivity", "utilities"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          { name: "Add a bill", short_name: "Add", url: "/subscriptions/new" },
          { name: "Due soon", short_name: "Due", url: "/occurrences?view=due" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        globIgnores: ["push-sw.js"],
        importScripts: ["push-sw.js"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
            method: "GET",
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: false,
      },
    },
  },
  preview: { port: 4173 },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
});
