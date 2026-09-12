'use client'

// Compact theme switcher for the shared RoleTopBar (every signed-in role).
// One tap cycles Terminal → Ember; the label always shows the active theme.
import { THEMES, setTheme, useTheme } from '@/lib/theme'

export default function ThemeSwitcher() {
  const theme = useTheme()
  const next = theme === 'terminal' ? THEMES[1] : THEMES[0]

  return (
    <button
      className="btn font-mono"
      style={{ minHeight: 40, padding: '0 0.7rem', fontSize: '0.7rem', whiteSpace: 'nowrap', flexShrink: 0 }}
      onClick={() => setTheme(next.id)}
      title={`Switch to ${next.label} theme`}
      aria-label={`Interface theme: ${theme}. Activate to switch to ${next.label}.`}
    >
      THEME: {theme.toUpperCase()}
    </button>
  )
}
