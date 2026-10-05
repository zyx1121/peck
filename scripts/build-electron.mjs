import { readFileSync } from "node:fs"
import { build } from "esbuild"
// package.json is the one place the version lives; Release Please bumps it.
const { version } = JSON.parse(readFileSync("package.json", "utf8"))
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
  define: { PECK_VERSION: JSON.stringify(version) },
  sourcemap: true,
})
