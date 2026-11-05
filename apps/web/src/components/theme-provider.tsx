"use client"

import * as React from "react"
import { ThemeProviderContext } from "@/contexts/theme-context"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

const isTheme = (value: string | null): value is Theme =>
  value === "light" || value === "dark" || value === "system"

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme
    try {
      const stored = window.localStorage.getItem(storageKey)
      return isTheme(stored) ? stored : defaultTheme
    } catch {
      return defaultTheme
    }
  })

  React.useEffect(() => {
    const root = window.document.documentElement
    const media = window.matchMedia("(prefers-color-scheme: dark)")

    const apply = (next: Theme) => {
      const resolved = next === "system" ? (media.matches ? "dark" : "light") : next
      root.classList.remove("light", "dark")
      root.classList.add(resolved)
      root.style.colorScheme = resolved
    }

    apply(theme)

    // "System" is a live choice, not a one-time snapshot. Without this listener
    // the app kept yesterday's theme if the OS switched while the tab was open.
    if (theme !== "system") return
    const onChange = () => apply("system")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = React.useCallback(
    (next: Theme) => {
      try {
        window.localStorage.setItem(storageKey, next)
      } catch {
        // Storage can be disabled; the in-memory choice still applies.
      }
      setThemeState(next)
    },
    [storageKey],
  )

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}
