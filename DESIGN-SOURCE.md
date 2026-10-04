# Design sources

Validated snapshot: 2026-10-02.

- Theme: https://ui.zyx.tw/r/theme.json, SHA-256 in theme-source.json.
- Contract: https://github.com/zyx1121/www.zyx.tw/blob/main/apps/ui/DESIGN.md.
- Corners, tips, mark and Inter 4.1: zyx1121/www.zyx.tw at
  cf03b1f, packages/ui/src. Imports and Next Link are adapted for portable React.
- Button and Tooltip: unmodified shadcn 4.21.1 base-nova output, Base UI 1.8.
- Noto Sans JP/TC and Geist Mono: Fontsource variable packages, served locally.
- Inter is distributed under the SIL Open Font License in src/fonts/LICENSE.txt.

The starter consumes stock neutral tokens, then the generated zyx-theme.css
overlay. npm run theme:sync reads the canonical registry and updates the overlay
and its hash. It does not fetch at runtime. Review and build after a refresh.
Fonts and application compositions are separate from the registry theme.

shadcn 4.21.1 currently fails to import this theme's flat @theme inline properties
with an "Unknown word 0.875rem" parser error. scripts/sync-theme.mjs serializes
the actual registry object instead, preserving its variables and nested rules.
Keep primitives CLI-owned. Recheck the importer on a future shadcn upgrade.
