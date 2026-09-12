'use client'

import SignOutButton from '@/components/SignOutButton'

// N8 Terminal command nav — `> roboko --<role>▮`. Same ownership/props, new voice.
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · design-system: design.md · designed-as-app
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
      <div className="term-prompt flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>&gt;</span>
        <span className="font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
          roboko
        </span>
        <span>--{flag}</span>
        <span aria-hidden="true" className="term-prompt__cursor" />
      </div>
      <div className="flex items-center gap-2">
        <span className="badge badge-neutral">{role}</span>
        <SignOutButton />
      </div>
    </div>
  )
}
