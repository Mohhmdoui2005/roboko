'use client'

import SignOutButton from '@/components/SignOutButton'

// Slim account bar rendered above every page of a role area via that
// area's layout.tsx — one place instead of a button in each page header.
export default function RoleTopBar({ role }: { role: string }) {
  return (
    <div
      className="w-full flex items-center justify-between gap-3 px-4"
      style={{
        minHeight: 52,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="inline-flex items-center justify-center w-6 h-6 rounded-md"
          style={{ border: '2px solid var(--color-accent)' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Roboko
        </span>
        <span className="badge badge-neutral">{role}</span>
      </div>
      <SignOutButton />
    </div>
  )
}
