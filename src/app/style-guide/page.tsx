// Hallmark · genre: atmospheric · macrostructure: Long Document · theme: Terminal · design-system: design.md · designed-as-app
export default function StyleGuidePage() {
  return (
    <div
      className="min-h-screen p-4 sm:p-8 space-y-10 sm:space-y-14 max-w-4xl mx-auto"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {/* ── Title ── */}
      <div className="section-head border-b pb-6" style={{ borderColor: 'var(--color-border)' }}>
        <span className="section-head__label">System reference</span>
        <h1 className="section-head__title" style={{ fontSize: '2rem' }}>
          Design System
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem' }}>
          Deep-Space Command Terminal — Roboko Platform
        </p>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
          All tokens are CSS variables in <code style={{ fontFamily: 'var(--font-mono)' }}>globals.css</code>.
          Never hard-code hex values in components.
        </p>
      </div>

      {/* ── 1. Color Tokens ── */}
      <section className="space-y-5">
        <div className="section-head">
          <span className="section-head__label">Tokens</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            1. Color Tokens
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { token: '--color-bg',           hex: '#060807', label: 'Abyss',              role: 'Page canvas' },
            { token: '--color-surface',       hex: '#0e1312', label: 'Carbon Surface',     role: 'Cards, containers' },
            { token: '--color-border',        hex: '#2b3532', label: 'Cold Charcoal',      role: 'Default 1px border' },
            { token: '--color-accent',        hex: '#00d992', label: 'Emerald Signal Green', role: 'Active/live/success ONLY' },
            { token: '--color-accent-text',   hex: '#2fd6a1', label: 'VoltAgent Mint',     role: 'Accent text on dark bg' },
            { token: '--color-text-primary',  hex: '#f2f2f2', label: 'Snow White',         role: 'Default text' },
            { token: '--color-text-secondary',hex: '#b8b3b0', label: 'Warm Parchment',     role: 'Body / secondary text' },
            { token: '--color-text-tertiary', hex: '#8b949e', label: 'Steel Slate',        role: 'Timestamps, metadata' },
            { token: '--color-warning',       hex: '#ffba00', label: 'Warning Amber',      role: 'Session expiring' },
            { token: '--color-danger',        hex: '#fb565b', label: 'Danger Red',         role: 'Errors, destructive' },
            { token: '--color-info',          hex: '#4cb3d4', label: 'Info Blue',          role: 'Info banners' },
          ].map(({ token, hex, label, role }) => (
            <div
              key={token}
              className="card flex items-center gap-4 p-4"
            >
              <div
                style={{ width: 40, height: 40, borderRadius: 6, background: `var(${token})`, flexShrink: 0,
                  border: '1px solid var(--color-border)' }}
              />
              <div className="min-w-0">
                <p style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '0.875rem' }}>
                  {label}
                </p>
                <code style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                  {token}
                </code>
                <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginTop: 2 }}>
                  {hex} · {role}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)' }}>
          <span className="font-mono" style={{ color: 'var(--color-accent-text)' }}>SIGNAL</span>
          {' '}Green is a signal, not decoration. It only ever means “live”, “active”, or “success”. If everything glows, nothing does.
        </p>
      </section>

      {/* ── 2. Typography ── */}
      <section className="space-y-6">
        <div className="section-head">
          <span className="section-head__label">Type</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            2. Typography
          </h2>
        </div>
        <div className="card card-emphasized p-6 space-y-5">
          <div>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Display / Chakra Petch (tight leading, -0.02em tracking)
            </p>
            <p style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--color-text-primary)', fontWeight: 700 }}>
              Robot Test Arena 4
            </p>
          </div>
          <div>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Body / Archivo (1.5 line-height, 16px min)
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
              Session started for “Bot Alpha”. Time remaining: 4:32. Present your lunch QR at the catering station.
            </p>
          </div>
          <div>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Mono / IBM Plex Mono (IDs, QR payloads only)
            </p>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--color-text-secondary)', background: 'var(--color-bg)', padding: '0.25rem 0.5rem', borderRadius: 4, display: 'inline-block', border: '1px solid var(--color-border)' }}>
              {`{"domain":"ROBOT_TEST","robot_id":"a3f2-..."}`}
            </code>
          </div>
        </div>
      </section>

      {/* ── 3. Buttons ── */}
      <section className="space-y-4">
        <div className="section-head">
          <span className="section-head__label">Actions</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            3. Buttons <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, fontSize: '0.875rem' }}>— min 48×48px touch target</span>
          </h2>
        </div>
        <div className="card p-6 flex flex-wrap gap-4 items-center">
          <button className="btn">Ghost / Outline</button>
          <button className="btn btn-primary">Primary Action</button>
          <button className="btn btn-danger">Destructive</button>
          <button className="btn" disabled>Disabled</button>
        </div>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
          Ghost = transparent bg, 1px border. Primary = Carbon Surface + Mint text. Destructive = Danger text/border.
        </p>
      </section>

      {/* ── 4. Status Badges ── */}
      <section className="space-y-4">
        <div className="section-head">
          <span className="section-head__label">Status</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            4. Status Badges
          </h2>
        </div>
        <div className="card p-6 flex flex-wrap gap-3 items-center">
          <span className="badge badge-success">Active</span>
          <span className="badge badge-success">Claimed</span>
          <span className="badge badge-success">Completed</span>
          <span className="badge badge-warning">Expiring</span>
          <span className="badge badge-warning">In Progress</span>
          <span className="badge badge-danger">Expired</span>
          <span className="badge badge-danger">Error</span>
          <span className="badge badge-info">Published</span>
          <span className="badge badge-neutral">Pending</span>
          <span className="badge badge-neutral">Unclaimed</span>
        </div>
      </section>

      {/* ── 5. Card States ── */}
      <section className="space-y-6">
        <div className="section-head">
          <span className="section-head__label">Surfaces</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            5. Card States
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          <div className="card p-5 sm:col-span-3">
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Default card
            </p>
            <p style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Bot Alpha</p>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>1px Cold Charcoal border</p>
          </div>
          <div className="card card-live p-5 sm:col-span-2">
            <p style={{ color: 'var(--color-accent)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Live / Active
            </p>
            <p style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Bot Bravo</p>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>2px Emerald border — “this one is live”</p>
          </div>
          <div className="card card-emphasized p-5 sm:col-span-5">
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Emphasized container
            </p>
            <p style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Section block</p>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>3px structural border</p>
          </div>
        </div>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
          Elevation via border weight/color — not box-shadow. Shadows are reserved for modals only.
        </p>
      </section>

      {/* ── 6. Countdown / Timer ── */}
      <section className="space-y-4">
        <div className="section-head">
          <span className="section-head__label">Time</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            6. Countdown / Timer States
          </h2>
        </div>
        <div className="card p-6 flex gap-10 items-start">
          <div className="text-left">
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginBottom: 4 }}>Normal</p>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '3rem', fontWeight: 700, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              4:32
            </span>
          </div>
          <div className="text-left">
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginBottom: 4 }}>≤ 30 s (slow pulse)</p>
            <span className="countdown-urgent" style={{ fontFamily: 'var(--font-mono)', fontSize: '3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              0:28
            </span>
          </div>
        </div>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
          Urgency: 1.8 s ease-in-out pulse — slow enough to read from across a room, not so fast it is distracting.
        </p>
      </section>

      {/* ── 7. Input ── */}
      <section className="space-y-3">
        <div className="section-head">
          <span className="section-head__label">Forms</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            7. Form Input
          </h2>
        </div>
        <div className="card p-6 space-y-4 max-w-sm">
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: 6 }}>
              Email address
            </label>
            <input className="input" type="email" placeholder="orga@event.com" />
          </div>
          <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
            Focus → border switches to Emerald accent. Min-height 48px.
          </p>
        </div>
      </section>

      {/* ── 8. Toast ── */}
      <section className="space-y-3">
        <div className="section-head">
          <span className="section-head__label">Feedback</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            8. Toasts / Feedback Banners
          </h2>
        </div>
        <div className="space-y-3 max-w-sm">
          <div className="toast-success px-4 py-3 rounded-lg text-sm font-medium">
            <span className="font-mono">OK</span> — Session started for “Bot Alpha”
          </div>
          <div className="toast-danger px-4 py-3 rounded-lg text-sm font-medium">
            <span className="font-mono">ERR</span> — Robot QR already has an active session
          </div>
        </div>
      </section>

      {/* ── 9. Principles ── */}
      <section className="space-y-5">
        <div className="section-head">
          <span className="section-head__label">Rules</span>
          <h2 className="section-head__title" style={{ fontSize: '1.125rem' }}>
            9. Design Principles
          </h2>
        </div>
        <div className="card card-emphasized p-6 space-y-3">
          {[
            ['Green is a signal, not decoration.', 'It only means “live”, “active”, or “success”. If everything glows, nothing does.'],
            ['Borders define containment.', 'Nothing floats on the dark canvas without a border. Use weight to signal importance: 1px → 2px green → 3px structural.'],
            ['Motion is slow and rare.', 'One pulse on the urgent countdown. No hover animations on every card. Old phones, all-day battery.'],
            ['Operational screens prioritize legibility.', 'Jury scorepad, orga scanners: 16px minimum text, 48px touch targets. Save density for admin/live dashboards.'],
          ].map(([title, body]) => (
            <div key={title as string}>
              <p style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '0.9375rem' }}>{title as string}</p>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: 2 }}>{body as string}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
