'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from './components/ui/button.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './components/ui/dropdown-menu.js'

import { THEME_KEY as KEY } from './theme-script.js'

type Theme = 'light' | 'dark' | 'system'

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)

  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/**
 * Light, dark or the system's, by the `dark` class on <html> that shadcn's
 * theme keys on - shadcn's own mode toggle. System is the default and follows
 * the OS as it changes. Remembered in this browser only. An app with its own
 * theme switch hides this: definePanel({ modeToggle: false }).
 */
export function ModeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    let stored: string | null = null

    try {
      stored = localStorage.getItem(KEY)
    } catch {}

    if (stored === 'light' || stored === 'dark') setTheme(stored)
  }, [])

  // Following the system: a change in the OS changes the page.
  useEffect(() => {
    if (theme !== 'system') return

    const media = matchMedia('(prefers-color-scheme: dark)')
    const follow = () => apply('system')

    media.addEventListener('change', follow)

    return () => media.removeEventListener('change', follow)
  }, [theme])

  const choose = (next: Theme) => {
    setTheme(next)
    apply(next)

    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {}
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Theme" />}>
        <Sun className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
        <Moon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => choose(value as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
