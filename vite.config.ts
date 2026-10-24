import { defineConfig } from "vite"
import deno from "@deno/vite-plugin"
import preact from "@preact/preset-vite"
import { lingui } from "@lingui/vite-plugin"

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    deno(),
    preact({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }),
    lingui(),
  ],
})
