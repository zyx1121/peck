"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"

type Theme = "dark" | "light"
const ThemeContext = createContext({ theme: "dark" as Theme, toggle: () => {} })
const key = "task-web-theme"

function initialTheme(): Theme {
  if (typeof document === "undefined") return "dark"
  return document.documentElement.classList.contains("light") ? "light" : "dark"
}

export function TaskThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const toggle = () => setTheme(previous => previous === "dark" ? "light" : "dark")
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    document.documentElement.classList.toggle("light", theme === "light")
    document.documentElement.style.colorScheme = theme
    try { localStorage.setItem(key, theme) } catch { /* Storage is optional. */ }
  }, [theme])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (event.key.toLowerCase() !== "d" || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]")) return
      setTheme(previous => previous === "dark" ? "light" : "dark")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function TaskThemeToggle({ lang = "en" }: { lang?: "en" | "zh-TW" }) {
  const { theme, toggle } = useContext(ThemeContext)
  const label = lang === "zh-TW" ? (theme === "dark" ? "切換淺色" : "切換深色") : (theme === "dark" ? "Switch to light" : "Switch to dark")
  return <Button type="button" variant="ghost" size="icon-sm" onClick={toggle} aria-label={label} title={label}>
    {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
  </Button>
}
