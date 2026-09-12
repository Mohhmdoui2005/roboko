// Hallmark · genre: atmospheric · macrostructure: Stat-Led · theme: Terminal · design-system: design.md · designed-as-app
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
        <div className="section-head pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="section-head__label">Venue display · knockout</span>
          <h1 className="section-head__title" style={{ fontSize: '1.75rem' }}>Knockout Bracket</h1>
          <p className="stat-hero__qualifier">
            Updates live — no refresh needed.
          </p>
        </div>
        <div className="overflow-x-auto card p-2">
          <BracketViz />
        </div>
      </div>
    </div>
  )
}
