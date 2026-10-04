import { packager } from "@electron/packager"
import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
const [platform = "darwin", arch = "arm64"] = process.argv.slice(2)
const stage = "output/package-stage"
await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
await cp("dist", `${stage}/dist`, { recursive: true })
await cp("dist-electron", `${stage}/dist-electron`, { recursive: true })
await cp("skills", `${stage}/skills`, { recursive: true })
const pkg = JSON.parse(readFileSync("package.json", "utf8"))
await writeFile(
  `${stage}/package.json`,
  JSON.stringify({
    name: pkg.name,
    productName: "Peck",
    version: pkg.version,
    main: pkg.main,
    description: pkg.description,
    author: pkg.author,
    license: pkg.license,
  })
)
const paths = await packager({
  dir: stage,
  out: "release",
  name: "Peck",
  platform,
  arch,
  electronVersion: pkg.devDependencies.electron,
  asar: true,
  overwrite: true,
  icon: "assets/Peck.icns",
  appBundleId: "tw.zyx.peck",
  appCategoryType: "public.app-category.developer-tools",
  executableName: "Peck",
  prune: false,
})
console.log(paths.join("\n"))
