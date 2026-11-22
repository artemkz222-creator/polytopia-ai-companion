import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/polytopia-ai-companion/",
  plugins: [react()],
});
