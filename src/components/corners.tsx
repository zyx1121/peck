import type * as React from "react"

import {
  type At,
  CornerScope,
  CornerTip,
} from "@/components/corner-tip"
import { ZyxMark } from "@/components/zyx-mark"
import { cn } from "@/lib/utils"

export { CornerTip }

/*
 * The frame every zyx.tw site shares: the logo top left, the page nav top
 * right, secondary links bottom left and the copyright bottom right. Each
 * corner is fixed 20 px in from the viewport's corner. All corners use
 * 16 px text on 24 px lines. An item in a corner
 * can carry a tip (`CornerTip`), which opens toward the page.
 */

const AT: Record<At, string> = {
  "top-left": "top-5 left-5",
  "top-right": "top-5 right-5",
  "bottom-left": "bottom-5 left-5",
  "bottom-right": "right-5 bottom-5",
}

/**
 * Text links in a corner: muted, lit on hover and for the current page. The
 * hit area reaches 8 px past the text on either side and stays 24 px tall
 * for both header and footer text, centered on the text line.
 */
export const cornerLink =
  "relative rounded-sm text-muted-foreground outline-offset-4 transition-colors after:absolute after:-inset-x-2 after:top-1/2 after:h-6 after:-translate-y-1/2 hover:text-foreground focus-visible:outline-2 aria-[current=page]:text-foreground"

/** The tips on Privacy and Terms, which www.zyx.tw's own links share. */
export const LEGAL_TIPS = {
  privacy: "What every zyx.tw site stores and logs",
  terms: "The rules for every zyx.tw site",
}

/**
 * Privacy and Terms, which every zyx.tw site shares at www.zyx.tw. They lead
 * the bottom left corner; the labels and their tips follow the site's
 * language.
 */
export function LegalLinks({
  labels = { privacy: "Privacy", terms: "Terms" },
  tips = LEGAL_TIPS,
}: {
  labels?: { privacy: string; terms: string }
  tips?: { privacy: string; terms: string }
}) {
  return (
    <>
      <CornerTip tip={tips.privacy}>
        <a href="https://www.zyx.tw/privacy" className={cornerLink}>
          {labels.privacy}
        </a>
      </CornerTip>
      <CornerTip tip={tips.terms}>
        <a href="https://www.zyx.tw/terms" className={cornerLink}>
          {labels.terms}
        </a>
      </CornerTip>
    </>
  )
}

/** One corner of the viewport. A page can fill one the layout leaves empty. */
export function Corner({
  at,
  className,
  ...props
}: React.ComponentProps<"div"> & { at: At }) {
  return (
    <CornerScope at={at}>
      <div
        className={cn(
          "fixed z-50 flex items-center gap-4 text-sm/6 text-foreground",
          AT[at],
          className
        )}
        {...props}
      />
    </CornerScope>
  )
}

/**
 * A transparent 12px backdrop blur fading out over 64px at the viewport edge,
 * under the corners so scrolling content stays behind the shared chrome. Pages that do not scroll leave it off.
 */
function EdgeFade({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden
      data-slot="corner-edge"
      data-edge={edge}
      className={cn(
        "pointer-events-none fixed inset-x-0 z-40 h-16",
        edge === "top" ? "top-0" : "bottom-0"
      )}
    />
  )
}

/*
 * `className` and `style` go on each corner rather than on the <header> or
 * <footer> around them: an entrance animation there would leave a transform
 * on the wrapper, and a transformed ancestor becomes the box that fixed
 * elements are placed in, which pulls the corners off the viewport's.
 */

/**
 * The top corners: the zyx mark, which mirrors itself on hover, and the page
 * nav. The mark links to `home`: "/" on www.zyx.tw, www.zyx.tw everywhere
 * else. Its tip says where: "Home" or the host.
 */
export function TopCorners({
  home = "https://www.zyx.tw",
  label = "zyx.tw",
  markTip = home.startsWith("/") ? "Home" : new URL(home).host,
  nav,
  fade = false,
  className,
  style,
}: {
  home?: string
  /** The mark's accessible name. */
  label?: string
  markTip?: React.ReactNode
  nav?: React.ReactNode
  fade?: boolean
  /** On each corner, e.g. an entrance animation or a theme scope. */
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <header>
      {fade && <EdgeFade edge="top" />}
      <Corner at="top-left" className={className} style={style}>
        <CornerTip tip={markTip}>
          <a
            href={home}
            aria-label={label}
            className="group rounded-sm outline-offset-4 focus-visible:outline-2"
          >
            {/* 20 px tall, the corners' line height. */}
            <ZyxMark className="h-5 w-auto group-hover:-scale-x-100 motion-safe:transition-transform motion-safe:duration-300" />
          </a>
        </CornerTip>
      </Corner>
      {nav && (
        <Corner at="top-right" className={className} style={style}>
          {nav}
        </Corner>
      )}
    </header>
  )
}

/**
 * The bottom corners: secondary links (privacy, source, Markdown) and the
 * copyright, whose tip names its holder. On a narrow screen the links wrap
 * upward instead of running into the copyright.
 */
export function BottomCorners({
  links,
  copyrightTip = "Loki",
  fade = false,
  className,
  style,
}: {
  links?: React.ReactNode
  copyrightTip?: React.ReactNode
  fade?: boolean
  /** On each corner, e.g. an entrance animation or a theme scope. */
  className?: string
  style?: React.CSSProperties
}) {
  const year = new Date().getFullYear()

  return (
    <footer>
      {fade && <EdgeFade edge="bottom" />}
      {links && (
        // Leaves 124 px for the insets, the copyright and a 20 px gap.
        <Corner
          at="bottom-left"
          className={cn(
            "max-w-[calc(100%-7.75rem)] flex-wrap gap-y-1",
            className
          )}
          style={style}
        >
          {links}
        </Corner>
      )}
      <Corner at="bottom-right" className={className} style={style}>
        {/* A prerendered page keeps the year it was built in; a client
            render in a later year leaves that text rather than tearing the
            tree down over one number. */}
        <CornerTip tip={copyrightTip}>
          <p
            className="text-muted-foreground tabular-nums"
            suppressHydrationWarning
          >
            © {year}
          </p>
        </CornerTip>
      </Corner>
    </footer>
  )
}
