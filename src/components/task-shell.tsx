"use client"

import type { ReactNode } from "react"
import { BottomCorners, LegalLinks, TopCorners } from "@/components/corners"
import { cn } from "@/lib/utils"

export function TaskShell({
  title,
  description,
  actions,
  children,
  wide = false,
  lang = "en",
  desktop = false,
}: {
  title: ReactNode
  description?: string
  actions?: ReactNode
  children: ReactNode
  wide?: boolean
  lang?: "en" | "zh-TW"
  desktop?: boolean
}) {
  const chinese = lang === "zh-TW"
  return (
    <>
      <a
        href="#task"
        className="fixed top-5 left-20 z-[60] -translate-y-24 rounded-md bg-background px-3 py-2 text-sm focus:translate-y-0"
      >
        {chinese ? "跳至主要內容" : "Skip to content"}
      </a>
      <TopCorners
        fade
        nav={
          actions && (
            <nav
              aria-label={chinese ? "任務操作" : "Task actions"}
              className="flex max-w-[calc(100vw-6.25rem)] items-center gap-4"
            >
              {actions}
            </nav>
          )
        }
      />
      <main
        id="task"
        tabIndex={-1}
        className={cn(
          "mx-auto w-full px-5 outline-none",
          desktop ? "flex h-svh flex-col pt-17 pb-16" : "min-h-svh pt-30 pb-25",
          !desktop &&
            (wide ? "max-w-6xl" : "max-w-xl lg:max-w-3xl 2xl:max-w-5xl")
        )}
      >
        <div className={desktop ? "mb-5 shrink-0" : "mb-10"}>
          <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
          {description && (
            <p
              className={cn(
                "text-sm text-muted-foreground",
                desktop ? "mt-1" : "mt-3"
              )}
            >
              {description}
            </p>
          )}
        </div>
        {children}
      </main>
      <BottomCorners
        fade
        links={
          <LegalLinks
            labels={chinese ? { privacy: "隱私", terms: "條款" } : undefined}
            tips={
              chinese
                ? {
                    privacy: "zyx.tw 各站的資料與紀錄方式",
                    terms: "zyx.tw 各站的使用條款",
                  }
                : undefined
            }
          />
        }
      />
    </>
  )
}
