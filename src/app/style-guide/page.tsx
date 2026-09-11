export default function StyleGuidePage() {
  return (
    <div
      className="min-h-screen p-8 space-y-16 max-w-4xl mx-auto"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {/* ── Title ── */}
      <div className="space-y-2 border-b pb-6" style={{ borderColor: 'var(--color-border)' }}>
        <h1 style={{ fontSize: '2rem', lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--color-text-primary)' }}>
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
      <section className="space-y-4">
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          1. Color Tokens
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { token: '--color-bg',           hex: '#050507', label: 'Abyss Black',      role: 'Page canvas' },
            { token: '--color-surface',       hex: '#101010', label: 'Carbon Surface',   role: 'Cards, containers' },
            { token: '--color-border',        hex: '#3d3a39', label: 'Warm Charcoal',    role: 'Default 1px border' },
            { token: '--color-accent',        hex: '#00d992', label: 'Emerald Signal Green', role: 'Active/live/success ONLY' },
            { token: '--color-accent-text',   hex: '#2fd6a1', label: 'VoltAgent Mint',   role: 'Accent text on dark bg' },
            { token: '--color-text-primary',  hex: '#f2f2f2', label: 'Snow White',       role: 'Default text' },
            { token: '--color-text-secondary',hex: '#b8b3b0', label: 'Warm Parchment',   role: 'Body / secondary text' },
            { token: '--color-text-tertiary', hex: '#8b949e', label: 'Steel Slate',      role: 'Timestamps, metadata' },
            { token: '--color-warning',       hex: '#ffba00', label: 'Warning Amber',    role: 'Session expiring' },
            { token: '--color-danger',        hex: '#fb565b', label: 'Danger Red',       role: 'Errors, destructive' },
            { token: '--color-info',          hex: '#4cb3d4', label: 'Info Blue',        role: 'Info banners' },
          ].map(({ token, hex, label, role }) => (
            <div
              key={token}
              className="card flex items-center gap-4 p-4"
            >
              <div
                style={{ width: 40, height: 40, borderRadius: 6, background: hex, flexShrink: 0,
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
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          ⚠️ Green is a signal, not decoration. It only ever means "live", "active", or "success". If everything glows, nothing does.
        </p>
      </section>

      {/* ── 2. Typography ── */}
      <section className="space-y-4">
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          2. Typography
        </h2>
        <div className="card card-emphasized p-6 space-y-5">
          <div>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Heading / system-ui (tight leading, -0.02em tracking)
            </p>
            <p style={{ fontFamily: 'var(--font-heading)', fontSize: '2rem', lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--color-text-primary)', fontWeight: 700 }}>
              Robot Test Arena 4
            </p>
          </div>
          <div>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Body / Inter (1.5 line-height, 16px min)
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
              Session started for Bot Alpha. Time remaining: 4:32. Present your lunch QR at the catering station.
            </p>
          </div>
          <div>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Monospace / SFMono (IDs, QR payloads only)
            </p>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--color-text-secondary)', background: 'var(--color-bg)', padding: '0.25rem 0.5rem', borderRadius: 4, display: 'inline-block', border: '1px solid var(--color-border)' }}>
              {`{"domain":"ROBOT_TEST","robot_id":"a3f2-..."}`}
            </code>
          </div>
        </div>
      </section>

      {/* ── 3. Buttons ── */}
      <section className="space-y-4">
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          3. Buttons <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, fontSize: '0.875rem' }}>— min 48×48px touch target</span>
        </h2>
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
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          4. Status Badges
        </h2>
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
      <section className="space-y-4">
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          5. Card States
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-5">
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Default card
            </p>
            <p style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Bot Alpha</p>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>1px Warm Charcoal border</p>
          </div>
          <div className="card card-live p-5">
            <p style={{ color: 'var(--color-accent)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Live / Active
            </p>
            <p style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Bot Bravo</p>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>2px Emerald border — "this one is live"</p>
          </div>
          <div className="card card-emphasized p-5">
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Emphasized container
            </p>
            <p style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Section block</p>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>3px Warm Charcoal border</p>
          </div>
        </div>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
          Elevation via border weight/color — not box-shadow. Shadows are reserved for modals only.
        </p>
      </section>

      {/* ── 6. Countdown / Timer ── */}
      <section className="space-y-4">
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          6. Countdown / Timer States
        </h2>
        <div className="card p-6 flex gap-10 items-center">
          <div className="text-center">
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginBottom: 4 }}>Normal</p>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '3rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
              4:32
            </span>
          </div>
          <div className="text-center">
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginBottom: 4 }}>≤ 30 s (slow pulse)</p>
            <span className="countdown-urgent" style={{ fontFamily: 'var(--font-mono)', fontSize: '3rem', fontWeight: 700 }}>
              0:28
            </span>
          </div>
        </div>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>
          Urgency: 1.8 s ease-in-out pulse — slow enough to read from across a room, not so fast it's distracting.
        </p>
      </section>

      {/* ── 7. Input ── */}
      <section className="space-y-4">
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          7. Form Input
        </h2>
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
      <section className="space-y-4">
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          8. Toasts / Feedback Banners
        </h2>
        <div className="space-y-3 max-w-sm">
          <div className="toast-success px-4 py-3 rounded-lg text-sm font-medium">
            ✓ Session started for "Bot Alpha"
          </div>
          <div className="toast-danger px-4 py-3 rounded-lg text-sm font-medium">
            ✕ Robot QR already has an active session
          </div>
        </div>
      </section>

      {/* ── 9. Principles ── */}
      <section className="space-y-4">
        <h2 style={{ fontSize: '1.125rem', color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
          9. Design Principles
        </h2>
        <div className="card card-emphasized p-6 space-y-3">
          {[
            ['Green is a signal, not decoration.', 'It only means "live", "active", or "success". If everything glows, nothing does.'],
            ['Borders define containment.', 'Nothing floats on the dark canvas without a border. Use weight to signal importance: 1px → 2px green → 3px charcoal.'],
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
