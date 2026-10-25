import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/natural_selection_playground/",
  plugins: [react()]
});
