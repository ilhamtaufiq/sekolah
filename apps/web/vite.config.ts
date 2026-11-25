import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Di dev, /api diteruskan ke backend Rust. Di produksi, nginx melakukan hal yang sama,
// sehingga frontend dan API berbagi origin dan tidak perlu CORS.
const apiTarget = process.env.VITE_API_PROXY ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": apiTarget },
  },
});
