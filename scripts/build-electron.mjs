import { build } from "esbuild"
await build({
  entryPoints: [
    "electron/main.ts",
    "electron/shell-preload.ts",
    "electron/page-preload.ts",
    "electron/bridge.ts",
  ],
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  sourcemap: true,
})
