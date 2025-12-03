// vite.config.js
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load all env vars from .env, .env.local, etc.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    define: {
      // Make sure this is available in your client code
      "import.meta.env.VITE_OPENWEATHER_API_KEY": JSON.stringify(
        env.VITE_OPENWEATHER_API_KEY
      ),
    },
  };
});
