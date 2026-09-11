import Link from 'next/link'

export default function Page() {
  return (
    <div className="min-h-screen p-5" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
            Orga Portal <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>— Roboko</span>
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Choose a station to open its scanner
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Lunch */}
          <div className="card card-emphasized p-6 flex flex-col gap-4">
            <div style={{ fontSize: '2rem' }}>🍽️</div>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
                Lunch
              </h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                Scan people&apos;s badges to claim lunch. Opens the lunch scanner station.
              </p>
            </div>
            <Link href="/orga/lunch" className="btn btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Open Lunch Scanner
            </Link>
          </div>

          {/* Testing */}
          <div className="card card-emphasized p-6 flex flex-col gap-4">
            <div style={{ fontSize: '2rem' }}>🤖</div>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
                Testing
              </h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                Scan robots&apos; QR codes to start test sessions. Opens the test room scanner.
              </p>
            </div>
            <Link href="/orga/testing" className="btn btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Open Testing Scanner
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}