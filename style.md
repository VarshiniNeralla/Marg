# Application Style Guide

This document summarizes the styles, design tokens, colors, typography, layout rules, and component patterns currently used across the Defectra/SiteSureLabs frontend.

## Sources Audited

- `frontend/shared/tokens.css` - canonical design tokens and global mobile baseline.
- `frontend/style.css` - landing, marketing, dashboard, analysis, live, remote, and shared page styling.
- `frontend/shared/styles.css` - auth, admin shared chrome, forms, cards, and scroll effects.
- `frontend/shared/dashboard-chrome.css` - compact dashboard navigation and segmented controls.
- `frontend/assistant-widget.css` - floating assistant theme and chat UI.
- `frontend/dev/dev.css` - dark developer portal theme.
- `frontend/admin/index.html` - large inline admin dashboard/report styling.
- Page HTML/SVG snippets that include inline color values.

## Design Direction

The application uses a clean SaaS visual style built around light surfaces, slate neutrals, blue primary actions, rounded cards, glass navigation, soft shadows, and mobile-first spacing. The product identity uses the SiteSureLabs wordmark treatment with Google Sans Flex and a small red endorsement/rule accent.

Major visual themes:

- Light product UI: white cards, slate text, blue action/focus states.
- Glass chrome: translucent white navigation, backdrop blur, subtle slate borders.
- Dashboard/admin UI: dense but polished cards, pill controls, metric gradients, macOS-like buttons.
- Marketing UI: white hero sections, large display type, animated/illustrative SVG accents.
- Dev portal: dark navy theme with indigo/blue accents.
- Assistant widget: iOS-like chat surfaces with blue brand launcher and neutral bubbles.

## Canonical Tokens

The primary design system lives in `frontend/shared/tokens.css`.

### Brand and Accent Colors

| Token | Value | Usage |
| --- | --- | --- |
| `--primary` | `#2563eb` | Canonical brand blue, primary actions, active tabs, focus accents |
| `--primary-hover` | `#1d4ed8` | Primary hover state |
| `--primary-active` | `#1e40af` | Primary active/pressed state |
| `--primary-gradient` | `linear-gradient(135deg, #2563eb 0%, #1a56db 100%)` | Primary gradient actions |
| `--primary-soft` | `rgba(37, 99, 235, 0.10)` | Soft blue backgrounds |
| `--primary-ring` | `rgba(37, 99, 235, 0.16)` | Focus rings and glow states |
| `--brand-red` | `#ed1c24` | Logo endorsement rule, marketing accent, focus accents |

### Neutral Colors

| Token | Value | Usage |
| --- | --- | --- |
| `--bg` | `#f1f5f9` | App background |
| `--card` | `#ffffff` | Cards, forms, panels |
| `--text` | `#1e293b` | Main text |
| `--text-muted` | `#64748b` | Secondary text, labels, helper copy |
| `--border` | `#e2e8f0` | Default borders and dividers |

Common additional neutrals:

- `#0f172a` - strong heading/nav text.
- `#111827` - body/hero text.
- `#334155` - dark slate secondary text/icons.
- `#475569` - medium slate text/icons.
- `#94a3b8` - subdued slate, timestamps, muted icons.
- `#cbd5e1` - light borders/dividers.
- `#f8fafc`, `#fafafa`, `#f4f6f8`, `#f3f4f6` - light panel and hover backgrounds.
- `#ffffff` - primary surface.
- `#000000`, `#030303`, `#15161a` - footer/admin dark actions.

### Semantic Colors

| Token | Value | Usage |
| --- | --- | --- |
| `--success` | `#16a34a` | Success states, positive metrics |
| `--success-bg` | `#f0fdf4` | Success soft background |
| `--danger` | `#dc2626` | Errors, destructive actions |
| `--danger-bg` | `#fef2f2` | Error soft background |
| `--warning` | `#d97706` | Warning states |
| `--warning-bg` | `#fffbeb` | Warning soft background |

Additional semantic colors used locally:

- Green: `#10b981`, `#22c55e`, `#34d399`, `#4ade80`, `#15803d`, `#137333`, `#107C41`.
- Red/rose: `#ef4444`, `#f87171`, `#b91c1c`, `#be3649`, `#c5221f`, `#d93025`.
- Amber/orange: `#f59e0b`, `#fbbf24`, `#fef3c7`, `#b45309`, `#C43E1C`, `#ea580c`.
- Violet: `#7c3aed`, `#6d28d9`, `#a78bfa`, `#6366f1`, `#4f46e5`.
- Cyan/sky: `#0ea5e9`, `#0284c7`, `#0369a1`, `#38bdf8`, `#60a5fa`, `#93c5fd`, `#1a73e8`, `#007aff`.

## Typography

### Font Families

| Token/Use | Stack |
| --- | --- |
| `--font-brand` | `"Google Sans Flex", "Google Sans", Inter, Roboto, sans-serif` |
| `--font-ui` | `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| `--font-sans` | `Inter, Roboto, "Google Sans", sans-serif` |
| Admin/report override | `"Google Sans Flex", "Google Sans", Inter, Roboto, sans-serif` |
| macOS-style admin controls | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif` |
| Dev monospace | `"JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace` |

Google Fonts imported in the app include:

- Google Sans Flex
- Tangerine
- Montserrat

### Type Scale

| Token | Value | Intended Usage |
| --- | --- | --- |
| `--text-display` | `clamp(2rem, 7vw, 3rem)` | Hero/display text |
| `--text-page-title` | `1.5rem` | Page title |
| `--text-section` | `1.25rem` | Section heading |
| `--text-card-title` | `1.0625rem` | Card/list heading |
| `--text-body` | `1rem` | Body text, also iOS no-zoom input floor |
| `--text-secondary` | `0.875rem` | Supporting text |
| `--text-caption` | `0.75rem` | Captions, metadata, compact labels |

Line-height and tracking:

- `--leading-tight: 1.15`
- `--leading-snug: 1.3`
- `--leading-normal: 1.5`
- `--tracking-tight: -0.02em`

Common local sizes:

- Landing hero title: `clamp(2.4rem, 5vw + 1rem, 6.35rem)`.
- Landing eyebrow/title: `clamp(1.85rem, 4.2vw, 2.85rem)`.
- Hero subtitle: `clamp(0.98rem, 1.85vw, 1.08rem)`.
- Nav/dropdown text: `14px`.
- Dashboard/admin compact labels: `0.7rem` to `0.875rem`.
- Admin stat values: around `1.9rem`.
- Dev portal base: `14px`.

## Spacing

The canonical spacing scale is:

| Token | Value |
| --- | --- |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-12` | `48px` |

Common layout patterns:

- Main containers use `width: min(1100px, 92%)`.
- Nav gutters use `clamp(0.75rem, 3vw, 2rem)`.
- Hero sections use clamp-based padding such as `clamp(28px, 5vh, 48px)`.
- Dense dashboard/admin controls use gaps around `0.45rem` to `1rem`.
- Mobile layouts use reduced padding around `0.55rem` to `0.85rem`.

## Radius

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-sm` | `8px` | Inputs, buttons, badges, chips |
| `--radius-md` | `12px` | Cards, list items, alerts |
| `--radius-lg` | `16px` | Large panels, modals, sheets |
| `--radius-xl` | `20px` | Hero containers, chat panels |
| `--radius-full` | `999px` | Pills, avatars, FABs |
| `--radius` | `12px` | Legacy alias |

Common local radii:

- Nav dropdowns and large sheets: `24px`.
- Admin metric cards: `14px`.
- macOS-style controls: `6px`.
- Dashboard hamburger/profile controls: `10px`.
- Assistant panel: `20px`.
- Circular badges and pills: `999px` or `9999px`.

## Shadows and Elevation

Canonical shadows:

| Token | Value |
| --- | --- |
| `--shadow-sm` | `0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.08)` |
| `--shadow-md` | `0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.06)` |
| `--shadow-lg` | `0 12px 32px rgba(15, 23, 42, 0.12), 0 4px 10px rgba(15, 23, 42, 0.06)` |
| `--shadow-xl` | `0 24px 60px rgba(15, 23, 42, 0.18), 0 8px 20px rgba(15, 23, 42, 0.08)` |
| `--shadow-btn` | `0 4px 14px rgba(37, 99, 235, 0.32)` |

Local shadow patterns:

- Glass nav: `0 8px 24px rgba(15,23,42,.055)` and subtle inset white highlights.
- Dropdowns: `0 24px 48px rgba(15, 23, 42, 0.08)`.
- Admin cards: `0 1px 3px rgba(15, 23, 42, 0.06)` with stronger hover shadows.
- Assistant: `0 8px 32px rgba(0, 0, 0, 0.18), 0 2px 12px rgba(0, 0, 0, 0.08)`.
- Footer: dark upward shadow `0 -24px 48px rgba(0, 0, 0, 0.35)`.

## Motion

Canonical motion tokens:

- `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`
- `--ease-spring: cubic-bezier(0.16, 1, 0.3, 1)`

Additional easing used locally:

- `cubic-bezier(0.34, 1.25, 0.64, 1)` for springy assistant/dashboard movement.
- `cubic-bezier(0.4, 0, 0.2, 1)` for Material-like progress motion.
- Short transitions are commonly `0.15s` to `0.35s`.
- Scroll reveal uses about `0.8s`.
- Reduced motion media queries disable major animations in several areas.

## Breakpoints and Mobile Baseline

Canonical breakpoint references:

- `--bp-tablet: 640px`
- `--bp-desktop: 1024px`

Global mobile rules:

- Images, SVGs, videos, and canvas elements use `max-width: 100%`.
- Inputs/selects/textareas are forced to at least `16px` on phone widths to prevent iOS focus zoom.
- Touch target helper `.tap-44` uses `44px` minimum width/height.
- Safe areas use `env(safe-area-inset-*)`.

Common local breakpoints:

- `390px` for very narrow nav/brand adjustments.
- `640px` for mobile admin/dashboard layout.
- `760px`, `768px`, `900px`, and `1100px` for responsive dashboard/report grids.

## Glass and Surface Styling

The app uses a glassmorphism layer mainly for navigation and chrome:

| Token | Value |
| --- | --- |
| `--glass-bg` | `rgba(255, 255, 255, 0.55)` |
| `--glass-bg-strong` | `rgba(255, 255, 255, 0.72)` |
| `--glass-border` | `rgba(255, 255, 255, 0.65)` |
| `--glass-border-soft` | `rgba(148, 163, 184, 0.25)` |
| `--glass-shadow` | `0 8px 32px rgba(15, 23, 42, 0.08)` |
| `--glass-blur` | `blur(18px) saturate(160%)` |

Common glass values:

- Nav background: `rgba(255, 255, 255, 0.82)` to `rgba(255, 255, 255, 0.92)`.
- Backdrop filters: `blur(12px)` to `blur(18px)` with `saturate(145%)` to `saturate(180%)`.
- Borders: `rgba(15, 23, 42, 0.06)` and `rgba(148, 163, 184, 0.22)`.

## Component Patterns

### Navigation

- Sticky top nav with white or translucent glass background.
- Product lockup uses Google Sans Flex, weight `500`, tight tracking (`-0.03em` to `-0.04em`).
- Logo height commonly uses `--logo-h: clamp(36px, 4.2vw, 42px)`.
- Parent endorsement text uses `#64748b`, uppercase, `0.12em` letter spacing, and a red `#ed1c24` rule.
- Dashboard nav uses centered segmented controls and compact 52px chrome.

### Buttons and Pills

- Primary buttons use the canonical blue family `#2563eb`, `#1d4ed8`, `#1e40af`.
- Secondary buttons use white/light slate surfaces such as `#f8fafc`, `#f4f6f8`, `#eff6ff`.
- Pills commonly use `border-radius: 999px`.
- Admin report controls include macOS-style variants:
  - Primary: `linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)`.
  - Secondary: `linear-gradient(180deg, #fff 0%, #f5f5f7 100%)`.
  - Danger: `linear-gradient(180deg, #ef4444 0%, #dc2626 100%)`.
  - Soft green/amber/rose backgrounds: `#f0fdf4`, `#fffbeb`, `#fff1f3`.

### Cards and Panels

- Product cards use white backgrounds, slate borders, radius `12px` to `16px`, and soft slate shadows.
- Admin metric cards use `linear-gradient(165deg, #ffffff 0%, #f8fafc 100%)`, radius `14px`, and a 3px top accent bar.
- Auth cards use `--card`, `--radius-lg`, and larger padding around `2.5rem`.
- Feature demo cards use white surfaces with `#e2e8f0` borders and lift on hover.

### Forms

- Forms inherit Inter/Google Sans depending on page.
- Inputs use 16px minimum on mobile.
- Focus rings use primary blue, for example `rgba(37, 99, 235, 0.16)` or stronger admin focus shadows.
- macOS date inputs use `#007aff` focus and a 6px radius.

### Footer

The site footer uses a dark theme:

| Token | Value |
| --- | --- |
| `--footer-bg` | `#030303` |
| `--footer-bg-deep` | `#000000` |
| `--footer-border` | `rgba(255, 255, 255, 0.07)` |
| `--footer-text` | `#a3a3a3` |
| `--footer-text-muted` | `#737373` |
| `--footer-heading` | `#fafafa` |
| `--footer-link` | `#e5e5e5` |
| `--footer-link-hover` | `#ffffff` |
| `--footer-link-underline` | `rgba(147, 197, 253, 0.85)` |

Social colors include:

- Instagram gradient: `#f09433`, `#e6683c`, `#dc2743`, `#cc2366`, `#bc1888`.
- LinkedIn: `#0a66c2`.

## Feature-Specific Palettes

### Admin Dashboard

Admin mostly aliases canonical tokens but includes local analytics colors:

- Workspace aliases: `--ws-accent: var(--primary)`, `--ws-ink: var(--text)`, `--ws-muted: var(--text-muted)`, `--ws-line: var(--border)`, `--ws-surface: var(--bg)`.
- Metrics:
  - Users: `#2563eb` to `#3b82f6`.
  - Uploads: `#0ea5e9` to `#38bdf8`.
  - Logs: `#7c3aed` to `#a78bfa`.
- Google/Material-style report progress:
  - Analyzing: `#1a73e8`.
  - Excel: `#107C41`.
  - PPTX: `#C43E1C`.
  - Prep: `#5f6368`.
  - Error: `#d93025`.
- Report job menu:
  - Retry/rose: `#be3649`, `#fff7f8`, `#fff1f3`.
  - Download/slate: `#334155`, `#f8fafc`, `#f1f5f9`.

### Dashboard Chrome

- Compact nav background: `rgba(255, 255, 255, 0.92)`.
- Segment track: `rgba(15, 23, 42, 0.05)`.
- Active segment: `#ffffff` with subtle slate shadow.
- Focus outline: `#2563eb`.
- Live collection status uses blue ripple/glow values around `rgba(37, 99, 235, 0.14)` to `rgba(37, 99, 235, 0.35)`.

### Landing and Marketing

- Hero and major sections are primarily white.
- Headings use strong slate/near-black: `#0f172a`, `#111827`.
- Supporting copy uses `#64748b`, `#4b5563`, `#8b8e96`.
- CTAs include dark admin variant `#15161a` and light admin report variant `#f4f6f8`.
- Demo accents use green `#4ade80`, violet gradients `#6366f1` to `#7c3aed`, and brand red `#ed1c24`.
- SVG illustrations use slate construction/inspection colors: `#475569`, `#64748b`, `#94a3b8`, `#cbd5e1`, plus accent blue/red/green/amber.

### Assistant Widget

Assistant local tokens:

| Token | Value |
| --- | --- |
| `--ass-brand` | `#2563eb` |
| `--ass-brand-deep` | `#1d4ed8` |
| `--ass-surface` | `#ffffff` |
| `--ass-thread` | `#f4f4f5` |
| `--ass-border` | `#e5e5e7` |
| `--ass-text` | `#0a0a0a` |
| `--ass-muted` | `#636366` |
| `--ass-user-bg` | `#111827` |
| `--ass-assistant-bg` | `#ececee` |
| `--ass-radius` | `20px` |

The assistant uses a fixed high z-index root, rounded launcher, mascot animation, white hint bubbles, and iOS-like chat bubbles.

### Developer Portal

The dev portal is a separate dark theme:

| Token | Value |
| --- | --- |
| `--dev-bg` | `#0b1220` |
| `--dev-bg-2` | `#0f172a` |
| `--dev-panel` | `#111c34` |
| `--dev-panel-2` | `#16223d` |
| `--dev-border` | `rgba(148, 163, 184, 0.18)` |
| `--dev-border-strong` | `rgba(148, 163, 184, 0.32)` |
| `--dev-text` | `#e2e8f0` |
| `--dev-text-dim` | `#94a3b8` |
| `--dev-text-mute` | `#64748b` |
| `--dev-primary` | `var(--primary)` |
| `--dev-primary-2` | `#60a5fa` |
| `--dev-danger` | `#ef4444` |
| `--dev-warn` | `#f59e0b` |
| `--dev-ok` | `#10b981` |
| `--dev-info` | `#38bdf8` |
| `--dev-radius` | `14px` |

Dev backgrounds use dark navy panels, radial login glows, and indigo/sky focus highlights.

## Accessibility and Interaction Notes

- Focus styles are present across nav, buttons, form inputs, dashboard segments, and assistant controls.
- The app uses reduced-motion media queries for scroll reveals, hero animation, dashboard widgets, and report spinners.
- Mobile input font size is protected at 16px to prevent iOS zoom.
- Touch target guidance is `44px`.
- Color contrast is generally strongest in text tokens (`#0f172a`, `#1e293b`, `#111827`) on white surfaces, while muted labels use `#64748b` or `#94a3b8`.

## Practical Guidance for Future Styling

- Prefer `frontend/shared/tokens.css` tokens for new work.
- Use `--primary` and related tokens instead of introducing new blues.
- Use `--text`, `--text-muted`, `--bg`, `--card`, and `--border` for default UI surfaces.
- Use semantic tokens for success/danger/warning states before adding local colors.
- Keep radii on the existing 8/12/16/20/full scale unless matching a local component family.
- Use the canonical shadow scale for new cards and panels.
- Preserve Google Sans Flex for brand/nav/report chrome and Inter/system fonts for general UI.
- Treat the dev portal and assistant widget as intentionally scoped theme islands.
