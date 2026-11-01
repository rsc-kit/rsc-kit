'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '../components/ui/button'

const KEY = 'rsc-kit-admin-theme'

/**
 * Light or dark, by the `dark` class on <html> that shadcn's theme keys on.
 * Remembered in this browser only. An app with its own theme switch can hide
 * this: definePanel({ modeToggle: false }).
 */
export function ModeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    let stored: string | null = null

    try {
      stored = localStorage.getItem(KEY)
    } catch {}

    const initial = stored ? stored === 'dark' : document.documentElement.classList.contains('dark')

    document.documentElement.classList.toggle('dark', initial)
    setDark(initial)
  }, [])

  const toggle = () => {
    const next = !dark

    document.documentElement.classList.toggle('dark', next)
    setDark(next)

    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light')
    } catch {}
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Use the light theme' : 'Use the dark theme'}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}
