# Design — Roboko Tournament

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
atmospheric (dark ops-terminal register; Terminal catalog theme)

## Macrostructure family
- Marketing/venue pages (`/live`, `/bracket`): Stat-Led (04) + H4 stat-led hero, T4 stat strip. Leaderboard count IS the hero.
- App pages (`/admin*`, `/orga*`, `/jury`, `/participant`): Bento Grid (01) + F1 bento knobs: tiles=6, spans=irregular, border=hairline-all. Command-center asymmetry, never 3-equal-cards.
- Content pages (`/login`, `/style-guide`): Long Document (02). Single column, literature over marketing.

## Theme
Terminal catalog, anchored on existing signal green. Dark paper only.
- `--color-paper`   oklch(13% 0.01 170)
- `--color-paper-2` oklch(18% 0.012 170)
- `--color-paper-3` oklch(23% 0.016 170)
- `--color-ink`     oklch(94% 0.006 90)
- `--color-ink-2`   oklch(75% 0.01 70)
- `--color-rule`    oklch(32% 0.015 170)
- `--color-accent`  oklch(75% 0.17 165)
- `--color-focus`   oklch(75% 0.17 165)

Existing hex aliases preserved in `globals.css`: `--color-bg #060807`, `--color-surface #0e1312`, `--color-raised #16201d`, `--color-accent #00d992`. New code references tokens by name, never raw hex.
Single namespace: `globals.css` aliases `paper/paper-2/paper-3/ink/ink-2/rule` to the page names above, plus `--color-accent-ink` (dark ink on accent fills), `--color-qr-paper` (QR contrast boxes only), `--font-display`/`--font-outlier`, and `--radius-card/pill/input`. Both names resolve to one value.

## Typography
- Display: Chakra Petch, weight 700, style normal (roman only)
- Body:    Archivo, weight 400
- Mono:    IBM Plex Mono, weight 500 (timings, queues, credentials, terminal nav)
- Display tracking: -0.02em; small labels +0.08em uppercase
- Type scale anchor: --text-display = clamp(2.75rem, 5vw + 1rem, 5.25rem); ratio 1.25; tabular-nums on all data

## Spacing
4-point named scale. Values in `tokens.css`. Pages must use named
tokens (`var(--space-md)`), never raw values.

## Motion
- Easings: cubic-bezier(0.16, 1, 0.3, 1) named `--ease-out`, etc.
- Reveal pattern: fade only, stagger --i * 60ms, cap 500ms
- Reduced-motion fallback: opacity-only, ≤ 150 ms.

## Microinteractions stance
- silent success over celebratory toasts
- hover delay 800 ms · focus delay 0 ms
- optimistic update + Undo over confirmation dialogs (jury scoring keeps two-step End only)
- transform + opacity only; no layout-property animation

## CTA voice
- Primary CTA: Carbon Surface fill, mint accent-text border, 8px radius, 48px min-height, verb-led ("Publish bracket", "Claim meal")
- Secondary CTA: transparent ghost, hairline border, same rhythm

## Per-page allowances
- Marketing/venue pages MAY use enrichment (Tier-A CSS art only: surface-grid blueprint, live-pulse dot).
- App pages MUST NOT use enrichment — function carries the page.
- Content pages: typography only.

## What pages MUST share
- The wordmark / logotype (ROBOKO, Chakra Petch 700).
- The accent colour and its placement (≤ 5 % per viewport, live/success/active only).
- The display + body fonts.
- The CTA voice (button shape, border-radius, padding rhythm).
- Section heading rhythm (stacked vertical: label above, heading directly underneath — never tag-left/heading-right).

## What pages MAY differ on
- Macrostructure within the page-type family.
- Hero archetype (within the family's allowance).
- Enrichment — only on venue pages, only Tier-A.

## Variants

### Ember (custom, switchable with Terminal)
Vibe: "daylight pit-lane, sun-baked, ember signal" · axes: light / display-heavy / warm.
Selected via the admin command-center switcher (`Terminal | Ember`), persisted in
`localStorage:roboko-theme`, applied as `data-theme` on `<html>` (see `src/lib/theme.ts`;
pre-paint init in `src/app/layout.tsx`). All token-driven components flip with no
logic changes; structures, macrostructure families, and CTA rhythm are shared.

- `--color-paper`   oklch(93% 0.020 75)   (`--color-bg`)
- `--color-paper-2` oklch(96.5% 0.012 80) (`--color-surface`)
- `--color-paper-3` oklch(90% 0.022 75)   (`--color-raised`)
- `--color-ink`     oklch(21% 0.012 60)
- `--color-ink-2`   oklch(45% 0.012 60)
- `--color-rule`    oklch(82% 0.025 78)   (`--color-border`)
- `--color-accent`  oklch(58% 0.17 38)    (ember; filled primary only)
- `--color-focus`   oklch(55% 0.20 38)

- Display: Bricolage Grotesk 700 (roman) · Body: Archivo 400 · Mono: IBM Plex Mono.
- Buttons: primary filled accent + ink text, 10px radius, one lift on hover, instant press.
- Semantic colors are independent of accent on light paper (success leaf-green,
  warning amber, danger red, info blue per `globals.css`).

## Exports

### tokens.css
```css
:root {
  --color-paper:      oklch(13% 0.01 170);
  --color-paper-2:    oklch(18% 0.012 170);
  --color-paper-3:    oklch(23% 0.016 170);
  --color-ink:        oklch(94% 0.006 90);
  --color-ink-2:      oklch(75% 0.01 70);
  --color-rule:       oklch(32% 0.015 170);
  --color-accent:     oklch(75% 0.17 165);
  --color-accent-ink: oklch(13% 0.01 170);
  --color-focus:      oklch(75% 0.17 165);

  --font-display: "Chakra Petch", "Archivo", system-ui, sans-serif;
  --font-body:    "Archivo", system-ui, sans-serif;
  --font-outlier: "IBM Plex Mono", ui-monospace, monospace;

  --space-3xs: 0.25rem;  --space-2xs: 0.5rem;  --space-xs: 0.75rem;
  --space-sm:  1rem;     --space-md:  1.5rem;  --space-lg: 2rem;
  --space-xl:  3rem;     --space-2xl: 4.5rem;  --space-3xl: 7rem;

  --text-xs: 0.75rem;  --text-sm: 0.875rem; --text-md: 1.125rem;
  --text-lg: 1.375rem; --text-xl: 1.75rem;  --text-2xl: 2.25rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 220ms;
  --radius-card: 8px; --radius-pill: 9999px; --radius-input: 8px;
}
```

### Tailwind v4 `@theme`
```css
@theme {
  --color-paper:   oklch(13% 0.01 170);
  --color-ink:     oklch(94% 0.006 90);
  --color-accent:  oklch(75% 0.17 165);
  --font-display:  "Chakra Petch", sans-serif;
  --font-body:     "Archivo", sans-serif;
  --spacing-md:    1.5rem;
  --text-md:       1.125rem;
  --ease-out:      cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`
```json
{
  "color": {
    "paper":  { "$value": "oklch(13% 0.01 170)", "$type": "color" },
    "ink":    { "$value": "oklch(94% 0.006 90)", "$type": "color" },
    "accent": { "$value": "oklch(75% 0.17 165)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Chakra Petch", "$type": "fontFamily" },
    "body":    { "$value": "Archivo", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1.5rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables
```css
:root {
  --background:         13% 0.01 170;
  --foreground:         94% 0.006 90;
  --primary:            75% 0.17 165;
  --primary-foreground: 13% 0.01 170;
  --muted:              32% 0.015 170;
  --muted-foreground:   75% 0.01 70;
  --border:             32% 0.015 170;
  --input:              32% 0.015 170;
  --ring:               75% 0.17 165;
  --radius:             8px;
}
```
