import { Resvg } from "@resvg/resvg-js"
import { readFileSync, writeFileSync } from "node:fs"
const mark = readFileSync("assets/Peck.svg", "utf8").replace(
  "<svg ",
  '<svg x="192" y="192" width="640" height="640" color="#ffffff" '
)
const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="64" y="64" width="896" height="896" rx="216" fill="#111111"/>${mark}</svg>`
const png = new Resvg(tile).render().asPng()
writeFileSync("assets/Peck.png", png)
const header = Buffer.alloc(8)
header.write("icns")
header.writeUInt32BE(png.length + 16, 4)
const chunk = Buffer.alloc(8)
chunk.write("ic10")
chunk.writeUInt32BE(png.length + 8, 4)
writeFileSync("assets/Peck.icns", Buffer.concat([header, chunk, png]))
