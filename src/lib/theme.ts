'use client'

import { useSyncExternalStore } from 'react'

// Theme registry: Terminal (default, :root) + Ember (custom, [data-theme="ember"]).
// Persisted in localStorage; applied as data-theme on <html> so every
// token-driven component flips without logic changes.

export type ThemeId = 'terminal' | 'ember'

const STORAGE_KEY = 'roboko-theme'

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'ember', label: 'Ember' },
]

export function getTheme(): ThemeId {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'ember' ? 'ember' : 'terminal'
  } catch {
    return 'terminal'
  }
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
}

export function setTheme(theme: ThemeId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // private mode — apply for this session only
  }
  applyTheme(theme)
  window.dispatchEvent(new Event('roboko-theme-change'))
}

function subscribeTheme(callback: () => void): () => void {
  window.addEventListener('roboko-theme-change', callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener('roboko-theme-change', callback)
    window.removeEventListener('storage', callback)
  }
}

// SSR-safe reader: server snapshot is always Terminal (matches SSR HTML),
// client re-reads localStorage after hydration — no hydration mismatch.
export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribeTheme, getTheme, () => 'terminal')
}
