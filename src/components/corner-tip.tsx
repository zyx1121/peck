"use client"

import * as React from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type At = "top-left" | "top-right" | "bottom-left" | "bottom-right"

const CornerContext = React.createContext<At>("top-left")

/**
 * Tells the tips in a corner which corner they sit in, and opens them at
 * once: an app without a TooltipProvider of its own would otherwise wait
 * Base UI's 600 ms.
 */
export function CornerScope({
  at,
  children,
}: {
  at: At
  children: React.ReactNode
}) {
  return (
    <CornerContext.Provider value={at}>
      <TooltipProvider>{children}</TooltipProvider>
    </CornerContext.Provider>
  )
}

/**
 * A bubble on hover, and on keyboard focus of a link or button, with what the
 * item's label leaves out. It opens toward the page, below the top corners and
 * above the bottom ones, lined up with the item's outer edge, so it never runs
 * off the viewport. `children` is the item itself: one element that takes the
 * trigger's ref and props. A component that sets its own onClick before
 * spreading its props, such as ThemeToggle, goes inside a span, or the
 * trigger's onClick replaces it. Without a `tip` the item renders as it is.
 */
export function CornerTip({
  tip,
  children,
}: {
  tip?: React.ReactNode
  children: React.ReactElement
}) {
  const at = React.useContext(CornerContext)
  const [dark, setDark] = React.useState(false)

  if (tip == null || tip === "") return children

  return (
    <Tooltip
      onOpenChange={(open, { trigger }) => {
        // The bubble is portalled to <body>, outside a corner's own scheme,
        // such as the dark corners over the www.zyx.tw home's 3D stage in
        // the light theme, so it copies a scheme set below <html>. The site's
        // own theme it inherits, and follows when that changes while open.
        if (open) setDark(trigger?.closest(".dark:not(html)") != null)
      }}
    >
      <TooltipTrigger render={children} />
      <TooltipContent
        side={at.startsWith("top") ? "bottom" : "top"}
        align={at.endsWith("left") ? "start" : "end"}
        // flex, not the stock inline-flex: in a line box the bubble would sit
        // on the page's line height and land a few px low.
        className={cn("flex", dark && "dark")}
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}
