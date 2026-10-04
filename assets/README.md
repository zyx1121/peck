# Peck identity

Peck temporarily uses the existing [zyx mark](https://www.zyx.tw/zyx.svg).
`Peck.svg` contains the same path as `src/components/zyx-mark.tsx`, with a tight
viewBox and `currentColor` fill.

The app icon is flat: a white zyx mark on a solid black rounded tile, with no
gradient, shadow, texture, or extrusion. `Peck.png` includes the transparent
margin; `Peck.icns` packages the same image for the application bundle.

Normal builds regenerate both files directly from `Peck.svg` with Resvg.
To regenerate them separately, run on the sandbox:

```sh
node scripts/icon.mjs
```

The mark is used for the application icon. The window itself is a browser
workspace, without a separate product heading or website corner branding.
