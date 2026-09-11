import BracketViz from '@/components/BracketViz'

export const metadata = {
  title: 'Knockout Bracket',
  description: 'Live tournament bracket',
}

export default function BracketPage() {
  return (
    <div className="min-h-screen p-4 sm:p-6"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Knockout Bracket</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Updates live — no refresh needed.
          </p>
        </div>
        <BracketViz />
      </div>
    </div>
  )
}
