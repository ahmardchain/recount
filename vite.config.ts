import { defineConfig } from "vite"

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 4179,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4187",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4179,
    strictPort: true,
  },
})
