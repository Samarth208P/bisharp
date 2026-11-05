# Bisharp design system

Bisharp uses the visual language of [Caldera](https://caldera.xyz/), adapted to a working cross-chain trading workspace. The supplied Caldera style reference is the source of truth for color, typography, radii, and surface treatment. Original Bisharp content and transaction behavior remain the product's foundation.

## Direction

The default route `/` is the application, not a landing page. Show route selection and the trading workspace immediately. Use compact DM Sans headings, quiet limestone cards, an orange primary action, readable balances, and a collapsible testnet note. Keep order creation, cost checks, funding, and activity together. No hero, promotional artwork, protocol strip, or marketing CTA appears on the app route.

The header's **How it works** link opens `/how-it-works` in a new tab, preserving in-progress work. This separate project page carries the Caldera-inspired visual storytelling: oversized compressed headlines, orange accents, animated violet/orange halftone, rounded sections, and generous spacing. It explains settlement, the distinctive architecture, and conditional economics. Every explanation page provides a clear **Open app** link back to `/`.

Application composition:

    brand          pill navigation          wallet
    compact workspace title                 route status
    collapsible testnet note + route selection
    order form                market reference
                              trade cost checks
                              funding and recovery
    order activity, filters, and transaction history
    compact footer + explanation link

Explanation page composition:

    brand          section links            open app
    display headline          animated halftone
    protocol context
    three settlement stages
    trader and solver economics
    editable assumptions      scenario margin
    distinctive architecture
    project questions
    orange closing section + open app

Profitability copy must be conditional. The example calculates hypothetical source-payment value minus destination-funding cost and execution/message costs, using exact cents. Positive, break-even, and negative presets show how costs affect the result. It is neither a live quote nor realized profit. Testnet bUSD has no dollar backing; never invent APY, returns, volume, or earnings. Describe the specific architecture rather than claiming unverified industry-first innovation.

The design follows the reference's unusual combination of industrial display type, medium body type, rounded surfaces, and high-density halftone. Avoid adding unrelated dashboards, fabricated metrics, stock imagery, shadows, or extra accent colors.

## Color tokens

| Token                   | Value     | Purpose                                       |
| ----------------------- | --------- | --------------------------------------------- |
| `--color-ember`         | `#fc5000` | Primary actions, market card, closing surface |
| `--color-plasma-violet` | `#524ae9` | Hero halftone field only                      |
| `--color-sulfur`        | `#f5f28e` | Tags, testnet notice, review warning          |
| `--color-limestone`     | `#f7f6f2` | Cards, navigation, quiet controls             |
| `--color-pumice`        | `#e2e2df` | Page canvas and inset amount field            |
| `--color-obsidian`      | `#070607` | Type, borders, selected controls              |
| `--color-chalk`         | `#ffffff` | Maximum contrast where needed                 |
| `--muted`               | `#585851` | Readable supporting text                      |
| `--line`                | `#c6c6bd` | Dotted separators and input boundaries        |

Use dark type on orange actions and financial information for legibility. Errors use explicit text, with an orange boundary or a darker orange text variant. Status must never depend on color alone.

## Typography

The actual font families were verified in Caldera's public styles on November 6, 2026. Both fonts are served locally using `next/font/local`; the application makes no Google Fonts or Framer font requests at runtime.

- **PP Neue Corp Compact Ultrabold**: `--font-display`, weight 400 (the font file itself is the ultrabold cut). Use for display headlines, section headings, prices, and step numbers. Enable `"ss06", "ss10"`, use positive `0.02em` tracking, and 0.94–1.0 display line-height.
- **DM Sans Medium**: `--font-body`, weight 500. Use for paragraphs, navigation, buttons, labels, and input content. Do not synthesize extra body weights.
- Fallbacks: Impact for display; Arial and system sans-serif for body.

| Role                  | Desktop                         | Mobile                           |
| --------------------- | ------------------------------- | -------------------------------- |
| Hero                  | Container-relative, up to 122px | Container-relative, minimum 48px |
| Major section heading | 58–88px                         | 62–66px                          |
| Closing headline      | 80–140px                        | 42–60px                          |
| Card heading          | 36–40px                         | 30–36px                          |
| Supporting heading    | 28–34px                         | 28–30px                          |
| Market value          | 78–108px                        | 94px                             |
| Body                  | 14–16px                         | 13–16px                          |
| Metadata and labels   | 11–13px                         | 10–12px                          |

Do not use the display face for addresses, error details, or detailed order terms. Numeric financial inputs remain legible, and actual balances and order data remain unmodified.

## Layout and surfaces

- Maximum content width: 1280px inside a 1360px outer container with 40px gutters.
- Desktop major section spacing: 80–88px; mobile: 56–60px.
- Card radius: 40px desktop, 28px for compact mobile cards.
- Buttons, navigation, and tags: 800px pill radius.
- Input radius: 100px. Minimum input/control heights: 44–48px.
- Card padding: 36px desktop, 20–24px mobile.
- Dotted dividers separate stages, balances, and order information.
- No box shadows. Use background colors to distinguish surfaces.
- At 800px the workspace becomes one column; market and funding can remain adjacent. At 560px the hero and all workspace cards stack, with usable 16px text inputs.
- Navigation remains available on mobile in a second, full-width pill row.

## Components

**Header:** Bisharp's faceted B mark with a diagonal routing cut and ember accent, wordmark, Trade and Activity anchors, a separate How it works page link, testnet indicator, and wallet action. Wallet state and handler remain connected to the existing application. The explanation page instead has section navigation and an Open app link.

**Hero:** Three-line compressed headline, concise supporting text, workspace and explanation anchors, and original procedural artwork. No market data is implied by the decorative pattern.

**Infrastructure strip:** Text treatments of Chainlink CCIP, Uniswap v3, and Ethereum, linked to their official sites. These describe protocol dependencies, not a claim of partnership or endorsement.

**Order card:** Inset principal field, paired solver/minimum and trigger/expiry fields, recipient and solver addresses, exact fee facts, and existing connect/review behavior. Form controls have explicit labels and retain their original validation.

**Market and funding:** Orange market card shows the real oracle value or an unavailable state. Limestone funding card preserves balances, faucets, fee refunds, and claims. Never fill empty states with fabricated data.

**Activity:** Pill filters expose their selected state through `aria-pressed`. Preserve source/destination stages, receipt metadata, conditional actions, pagination, and transaction links.

**Review:** Limestone modal over a dimmed canvas, dotted term rows, sulfur risk notice, checkbox acknowledgement, and orange signing action. Preserve focus trapping, Escape handling, and pending-transaction protection.

## Motion

Motion is implemented without an additional animation dependency.

| Element               | Behavior                                     | Timing                  |
| --------------------- | -------------------------------------------- | ----------------------- |
| Hero headline         | Clipped upward reveal; three staggered lines | 850ms, 100ms stagger    |
| Hero copy and actions | Short upward entrance                        | 800ms, 200/300ms delays |
| Hero artwork          | Initial opacity and subtle scale entrance    | 1100ms                  |
| Halftone              | Slowly evolving orange dot radii on violet   | Canvas, capped at 30fps |
| Major sections        | Single intersection-triggered entrance       | 650ms, 24px travel      |
| Buttons               | Surface change, directional arrow response   | 200–300ms               |
| Review dialog         | Short opacity/position entrance              | 250ms                   |

The shared easing is `cubic-bezier(.22, 1, .36, 1)`. Animate opacity and transforms for DOM transitions. The halftone is an original mathematical field, not copied video or a downloaded hero image. Its pixel ratio is capped at 1.5, and drawing stops when offscreen, the document is hidden, or the user pauses it. Observers, listeners, and frame callbacks are cleaned up on unmount.

`prefers-reduced-motion` disables entrances and smooth scrolling and renders a static halftone frame. A visible pause/play control allows independent control of continuous artwork. Text and controls remain visible without reveal JavaScript.

## Accessibility and interaction

- Keep the skip link, meaningful section anchors, keyboard focus rings, explicit form labels, modal focus behavior, live alerts, and selected-state semantics.
- Decorative artwork and glyphs are hidden from assistive technology. Icon-only actions have accessible labels.
- Testnet limitations, transaction review, and risk acknowledgement remain visible at the relevant decision points.
- Keep production guarantees and actual deployment state separate from presentation. The site must not imply guaranteed fills, instantaneous settlement, or a deployed route when one is unavailable.
- All trading actions use the original handlers and on-chain data. No contract, ABI, route configuration, fee calculations, or settlement rules changed for this redesign.

## Files and asset provenance

- `src/app/globals.css`: global tokens, page composition, components, responsive rules, and CSS motion.
- `src/app/cross.css`: order stages, route selection, pagination, and local explorer.
- `src/app/visuals.tsx`: original brand mark, arrows, procedural halftone, and viewport reveals.
- `src/app/workspace.css`: compact application-only layout and typography.
- `src/app/how-it-works/`: explanation route, scoped storytelling styles, and interactive margin illustration.
- `src/lib/solver-economics.ts`: exact-cent arithmetic for hypothetical solver scenarios.
- `src/app/layout.tsx`: locally hosted fonts.
- `src/app/page.tsx`: page composition and existing trading interactions.
- `public/fonts/pp-neue-corp-compact-ultrabold.woff2`: font referenced by Caldera at `https://framerusercontent.com/assets/anhv7YNRKQqdqHA0p1TSuTJHY4M.woff2`.
- `public/fonts/dm-sans-latin.woff2`: DM Sans Latin font from `https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2`.

PP Neue Corp is a commercial typeface. The downloaded reference asset is included to fulfill the requested exact typography; its public availability does not grant a webfont license. A suitable Pangram Pangram webfont license is needed for public use. DM Sans is distributed under the SIL Open Font License; its license is included alongside the font.

## Verification

### Dropdowns, scrolling, and route readiness

Use `SelectField` for route and expiry choices. It is a select-only combobox with a limestone popup, sulfur selection, a checkmark, and a separate hover/keyboard focus state. Enter/Space opens or commits; arrows and Home/End navigate; typing finds a label; Escape cancels; Tab commits and advances focus. Outside clicks dismiss without changing the selection. The menu flips above the trigger when needed, limits its height to available space, and scrolls its options independently of the page. Do not reintroduce platform-blue native option menus.

The page uses an explicit light color scheme, a stable scrollbar gutter, and narrow neutral scrollbar thumbs. Menus and review dialogs contain scroll gestures. Opening a review dialog locks page scrolling; closing it restores the previous state.

A deployed contract with matching selectors, a zero peer, and a remaining pairing authority is **awaiting activation**, not a broken route. Present one neutral status panel with route details and a refresh action. Keep balances and the oracle readable, but block transactions until the relevant side is paired and its data is fresh. New orders require both sides to be ready. Wrong peers, wrong selectors, inconsistent authority, RPC failures, and stale snapshots must still block writes and surface actionable feedback. A healthy source retains recovery access during a destination failure.

Run `npm run typecheck`, `npm run test:ui`, and `npm run build` after frontend changes. Use `npm run check:public-build` for the existing public-build safeguards. Check desktop and narrow mobile layouts in a browser, including wallet-unavailable feedback, route switching, order filters, funding disclosure, review dialog, keyboard navigation, and reduced motion. Live transaction tests require the configured test chains and wallet.

## Simple default form

Keep payment, destination funding, minimum received, and trigger price visible because they define the order. Collapse optional expiry, recipient and solver overrides under Order settings. Show a compact summary of the current defaults even while settings are closed. Keep costs and the final transaction review visible. Draft tools, scenario calculations, balances and test-token utilities use native keyboard-accessible disclosures, closed initially. Disclosure state must never reset field values or change transaction terms.
