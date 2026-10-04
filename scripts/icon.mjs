import { Resvg } from "@resvg/resvg-js"
import { readFileSync, writeFileSync } from "node:fs"
const png = new Resvg(readFileSync("assets/Peck.svg")).render().asPng()
writeFileSync("assets/Peck.png", png)
const header = Buffer.alloc(8)
header.write("icns")
header.writeUInt32BE(png.length + 16, 4)
const chunk = Buffer.alloc(8)
chunk.write("ic10")
chunk.writeUInt32BE(png.length + 8, 4)
writeFileSync("assets/Peck.icns", Buffer.concat([header, chunk, png]))
