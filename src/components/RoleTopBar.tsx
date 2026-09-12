'use client'

import SignOutButton from '@/components/SignOutButton'
import ThemeSwitcher from '@/components/ThemeSwitcher'

// N8 Terminal command nav — `> roboko --<role>▮`. Same ownership/props, new voice.
// Hallmark · nav: N8 Terminal command · genre: atmospheric · theme: Terminal · design-system: design.md · designed-as-app
export default function RoleTopBar({ role }: { role: string }) {
  const flag = role.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return (
    <div
      className="w-full flex items-center justify-between gap-3 px-4"
      style={{
        minHeight: 52,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div className="term-prompt flex items-center gap-2 text-sm min-w-0"
        style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>&gt;</span>
        <span className="font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
          roboko
        </span>
        <span>--{flag}</span>
        <span aria-hidden="true" className="term-prompt__cursor" />
      </div>
      <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
        <span className="badge badge-neutral">{role}</span>
        <ThemeSwitcher />
        <SignOutButton />
      </div>
    </div>
  )
}
