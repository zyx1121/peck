import { build } from "esbuild"
import { _electron as electron } from "playwright"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const dir = resolve("output/brand")
await mkdir(dir, { recursive: true })
await build({
  entryPoints: ["scripts/brand-scene.ts"],
  outfile: `${dir}/scene.js`,
  bundle: true,
  format: "iife",
})
const svg = await readFile("assets/Peck.svg", "utf8")
await writeFile(
  `${dir}/index.html`,
  `<!doctype html><style>html,body{margin:0;overflow:hidden}</style><body><script>window.addEventListener('error',e=>window.brandError=e.message);window.peckSvg=${JSON.stringify(svg)}</script><script src="scene.js"></script></body>`
)
await writeFile(
  `${dir}/main.cjs`,
  `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:1024,height:1024,useContentSize:true,webPreferences:{sandbox:true}});w.loadFile(__dirname+'/index.html')})`
)
const app = await electron.launch({
  args: [
    `${dir}/main.cjs`,
    ...(process.platform === "linux"
      ? [
          "--no-sandbox",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ]
      : []),
  ],
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => window.brandReady || window.brandError)
  const error = await page.evaluate(() => window.brandError)
  if (error) throw new Error(error)
  await page.screenshot({ path: "assets/Peck-material.png" })
} finally {
  await app.close()
}
