# WorkEasy360 design system

All WorkEasy360 products share one design system: CRM, HRMS, Helpdesk, AI Agent Platform, AI Form Builder and Commerce. Each product has its own navigation and screens, but they all use the same colours, type, spacing, components and interaction rules.

This file applies to every product. Copy it into a new product's `docs/` folder unchanged, and put that product's own details in the sections marked **Per product**.

## The code behind it

The design lives in the `packages/ui` package. Copy the whole folder into a new product (or install it as a shared package):

| File | What it holds |
|---|---|
| `src/tokens.ts` | Every colour, size, radius, shadow and motion value, published as `--we-*` CSS custom properties |
| `src/admin-css.ts` | The `c-*` component classes. They read only tokens |
| `src/components/logo.tsx` | `BrandMark`, the lockups and `PRODUCT_NAME` |
| `src/components/page.tsx` | `Page`, `PageHeader`, `Card`, `StatCard`, `EmptyState` |
| `src/components/` (rest) | Dialog, icons, theme toggle, agent avatar, rich content |
| `assets/logo.jpg` | The original logo artwork |

**Rule:** never hardcode a colour, size or radius in a page. If a token is missing, add it to `tokens.ts`.

## Name and logo

- **Per product:** set `PRODUCT_NAME` in `logo.tsx`. Lockups show "Workeasy" with the product name beneath it, for example "AI Commerce", "CRM" or "HRMS".
- `BrandMark` and the `icon.svg` favicons draw a vector traced from the logo, in the logo green `#00BF62` (`brand.logo`). Use that green for the mark only, never for UI.
- Leave existing technical identifiers (package names, DNS records, database marks) unchanged when renaming a product, so nothing that already exists breaks.

## Colour

Aim for roughly **70% white and neutral surfaces, 20% navy structure and 10% green accents**.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--we-primary` | `#1B3040` navy | `#27455A` | Navigation, headings, high-emphasis structure (bulk bar, hero, badges) |
| `--we-primary-hover` | `#112532` | `#315770` | Hover on navy fills |
| `--we-accent` | `#4ADE80` green | `#4ADE80` | Primary buttons, active indicators, progress, "done" ticks |
| `--we-accent-hover` | `#22C55E` | `#22C55E` | Hover on green fills |
| `--we-on-accent` | `#1B3040` | `#112532` | Text on green (7.8:1). White on green fails contrast |
| `--we-accent-soft` / `--we-accent-strong` | `#DCFCE7` / `#166534` | | Pale green background / green text |
| `--we-background` | `#F8FAFC` | `#0B1620` | Application canvas, table headers |
| `--we-surface` | `#FFFFFF` | `#112532` | Cards, top bar, inputs, menus, dialogs |
| `--we-surface-muted` | `#F1F5F9` | `#16303F` | Hover, selected rows, tags, segmented tracks |
| `--we-border` / `--we-border-strong` | `#E2E8F0` / `#CBD5E1` | `#27455A` / `#36576E` | Card and table lines / button outlines and dashed edges |
| `--we-border-input` | `#7D8BA0` | `#5A7A91` | Text field outlines: at least 3:1 against every surface they sit on (WCAG 1.4.11) |
| `--we-text-primary` | `#1B3040` | `#F1F5F9` | Headings, titles, values |
| `--we-text-body` | `#334155` | `#CBD5E1` | Body text |
| `--we-text-secondary` | `#64748B` | `#94A3B8` | Hints, labels, metadata |
| `--we-link` | `#166534` | `#4ADE80` | Text links, always underlined |
| `--we-focus` | `#1B3040` | `#4ADE80` | Focus rings. Green on navy surfaces (sidebar, bulk bar) |

**Never use brand green for small text on white** (1.9:1). For green text, use `--we-accent-strong` or `--we-success-text`. Secondary text passes AA on white and on the canvas, but not on `--we-surface-muted` (4.3:1), so don't put it there.

### Status colours

Each status has three steps:
- **base**, for icons, dots and borders
- **`-soft`**, a pale background
- **`-text`**, a dark foreground that passes AA on the soft background (6.4–7.6:1)

Badges and alerts always pair the colour with a label and a dot, so status never depends on colour alone.

| Status | Base | Soft | Text |
|---|---|---|---|
| success | `#16A34A` | `#DCFCE7` | `#166534` |
| info | `#2563EB` | `#DBEAFE` | `#1E40AF` |
| warning | `#D97706` | `#FEF3C7` | `#92400E` |
| error | `#DC2626` | `#FEE2E2` | `#991B1B` |
| ai | `#7C3AED` | `#EDE9FE` | `#5B21B6` |

`--we-rating` (`#B45309`) is for star ratings only.

### Charts

- Charts sit on white surfaces with `--we-border` grid lines and secondary-text axes.
- Series take `--we-chart-1…3` in a fixed order:

  | Mode | Navy-blue | Green | Violet |
  |---|---|---|---|
  | Light | `#235E9C` | `#16A34A` | `#8B5CF6` |
  | Dark | `#5A93D8` | `#1FAF55` | `#9F7AEA` |

- Both sets pass the dataviz palette validator: lightness band, chroma, colour-blind and normal-vision separation, and 3:1 contrast. Brand navy is too grey to separate as a series, so series 1 is a more saturated navy-blue.
- Green and amber are hard to tell apart for colour-blind users, so amber is kept for ratings and is not a series colour.
- A fourth series folds into "Other".
- Text in charts uses text tokens, never the series colour.

### Dark mode

Dark mode follows the operating system until someone chooses with the theme toggle. The choice is saved per browser and applied before first paint. Dark values are their own steps, not an automatic inversion.

## Type, spacing and shape

- **Font:** Inter, self-hosted by `next/font`. Numbers in tables, stats and charts use tabular numerals.
- **Type scale** (`--we-font-size-*`): page heading 24/600 (`xl`), section heading 18/600 (`lg`), component heading 16/600 (`md`), body 14/400 (`base`), secondary 13 (`sm`), metadata 12 (`xs`). Weights are 400, 500 and 600 only.
- **Spacing:** a 4px grid (`--we-space-1…12`: 4, 8, 12, 16, 20, 24, 32, 48).
- **Radii:**
  - `--we-radius-sm` 6px: tags and small chips
  - `--we-radius-md` 8px: inputs, buttons, menu items
  - `--we-radius-lg` 12px: cards, tables, popovers
  - `--we-radius-xl` 16px: dialogs
- **Shadows:** `--we-shadow-sm` for cards and `--we-shadow-md` for tooltips, both nearly flat. `--we-shadow-lg` is for floating layers only (menus, dialogs, the mobile drawer).
- **Sizes:**
  - sidebar 248px
  - top bar 56px
  - controls 36px (small 30px)
  - nav items 36px
  - icons 18px
- **Motion:** 150ms for hover and focus changes, 200ms for the drawer, both using `--we-motion-ease`. Transitions and animations are removed under `prefers-reduced-motion`.

## Components

| Component | Classes | Notes |
|---|---|---|
| Buttons | `c-btn` (secondary), `c-btn-primary` (green), `c-btn-dark` (navy), `c-btn-danger`, `c-btn-ghost`, `c-btn-sm`, `c-btn-icon` | One primary button per view. Disabled at 50% |
| Inputs | `c-input`, `c-select`, `c-textarea`, `c-input-group`, `c-tags`, `c-search` | Navy focus border plus ring; `aria-invalid` turns them red |
| Choices | `c-check-input`, `c-radio-card`, `c-segmented`, `c-range` | |
| Navigation | `c-nav`, `c-tabs`, `c-back`, `c-pager` | Active means navy text plus a green indicator |
| Content | `c-card`, `c-stat`, `c-table`, `c-kv`, `c-checklist`, `c-feature-list` | Tables stack into labelled rows on phones (`c-table-stack`) |
| Status | `c-badge[data-tone]`, `c-alert[data-tone]`, `c-progress`, `c-skeleton`, `c-empty` | Tones: success, warning, danger, info, brand, ai |
| Floating | `c-menu`, `c-listbox`, `c-dialog`, `c-drawer`, `c-chart-tip`, `c-fab`, `c-chatbox` | `c-fab` is the AI assistant launcher, fixed to the bottom-right corner. `c-chatbox` is its chat window (full screen on phones). See `ai-assistant-blueprint.md` |
| Charts | `c-chart`, `c-barlist`, `c-funnel` | |

## Application shell

Every product uses this shell; only the navigation items differ.

- **Sidebar** (navy, 248px): product logo and name, then the navigation in groups. The active item has a lighter fill, a green bar and a green icon. On screens narrower than 960px the sidebar becomes a drawer.
- **Top bar** (white, 56px):
  - Left: the workspace switcher and search. Search jumps to any module or page the role can open; press `/` or Ctrl+K to focus it.
  - Right: product actions, notifications, settings, the theme toggle and the account menu.
- **Notifications** list what needs attention, using the counts the module pages already show. Each role sees only what it can act on.

## The page contract

Every page has the same skeleton, built from `@workeasy/ui/react`:

1. `<Page>`: centred container, 1200px wide. A `narrow` page keeps the same left edge and caps its content at 880px.
2. `<PageHeader eyebrow title subtitle actions>`. The primary action sits at the right edge.
3. An optional `.c-toolbar` (search, filters) or `.c-tabs`.
4. Content: `<Card>`, `.c-stats` with `<StatCard>`, `.c-table-wrap` tables, `.c-form` forms.
5. Before there is data: `<EmptyState icon title actions>`.

Declare the product's modules once, in one file (Commerce uses `apps/admin/src/lib/modules.tsx`), with each module's label, path, group, icon, permission, summary, primary action and feature list. The sidebar, the search and each module page all read from that list, so a module's name or icon can't drift between places.

The sidebar shows only the modules the user's role can open. The API enforces the same permissions on every request.

## Per product

**Product name:** `HRMS`. Lockups read "Workeasy" with "HRMS" beneath it. The browser title is `<Module> · WorkEasy360`.

**Workspace:** a company — the organisation the signed-in user belongs to. Every API query is scoped by `organizationId` and a user belongs to exactly one organisation, so there is nothing to switch between. The top-bar slot Commerce gives to its store switcher holds a breadcrumb here: group name, then the active module.

**Modules and sidebar groups.** Declared once in [frontend/src/lib/navigation.ts](../frontend/src/lib/navigation.ts) as `NAV_GROUPS`; the sidebar, the command palette and the per-page access check all read that one list. Groups in order:

| Group | Modules (path · permission needed to see it) |
|---|---|
| *(ungrouped, first)* | Home `/dashboard` |
| My Workspace | My Profile `/my-profile`, My Attendance `/my-attendance`, My Leave `/my-leave`, My Timesheet `/my-timesheet`, My Tasks `/my-tasks`, My Goals `/goals`, My Payslips `/my-payslips`, My Expenses `/my-expenses`, My Loans `/my-loans`, My Assets `/my-assets` — every one open to all signed-in users |
| People | Directory `/people` · `employee:read`; Approvals `/approvals`; Shifts `/shifts` |
| Talent | Onboarding `/onboarding` · `onboarding:manage`; Performance `/performance`; Recruitment `/recruitment` · `recruitment:manage` |
| HR Services | Help Desk `/helpdesk`; Announcements `/announcements`; HR Guide `/hr-guide`; Assets `/assets` · `asset:manage` |
| Payroll & Insights | Payroll `/payroll` · any of `payroll:manage`, `compensation:manage`, `expense:manage`, `loan:manage`; Reports `/reports` · `employee:read`; Automation `/automation` · `automation:manage` |
| Settings *(pinned to the bottom)* | Organization `/settings/organization`; Security `/settings/security` |

A module with no permission listed is open to every signed-in user. Groups whose modules are all hidden disappear; a group can be collapsed, and the group holding the active page is always open. A user who reaches a page their role cannot open gets an `EmptyState` with the way back to Home, and the API refuses the request as well.

**Top-bar product actions:** none. HRMS has no customer-facing surface to jump to. The left of the top bar holds the breadcrumb and search (`/` or Ctrl+K); the right holds the approvals bell, the theme toggle and the account menu — which carries My profile, Security (labelled "Security · turn on 2FA" until TOTP is on) and Sign out. There is no settings icon, because Settings is a sidebar group.

**Notifications:** the bell shows what is waiting on the signed-in user to approve, from the same endpoints the Approvals page uses — leave requests, timesheets, expense claims and loan requests (see [frontend/src/lib/use-pending-approvals.ts](../frontend/src/lib/use-pending-approvals.ts)). It counts only the rows the backend says this user may act on, so an employee with no reports sees zero while a manager or HR admin sees their own queue; rows at zero are left out, and every row links to `/approvals`. Counts refresh on navigation and once a minute. Separately, a user still on a temporary password gets a warning banner under the top bar until they set their own.

**Customer-facing pages:** none. The only pages outside the signed-in shell are Login, Register, Forgot password and Reset password, and they wear WorkEasy360's own brand, not the employer's. Nothing in HRMS remaps `--we-accent`, `--we-primary`, `--we-link` or `--we-focus` the way a Commerce storefront does.

### How this product implements it

The design system lives in [frontend/src/ui](../frontend/src/ui), laid out like the shared `packages/ui` so it can be lifted into one package without moving code:

| File | What it holds |
|---|---|
| [ui/tokens.css](../frontend/src/ui/tokens.css) | Every `--we-*` value, light and dark, plus the `[data-region="primary"]` swap for navy regions |
| [ui/admin.css](../frontend/src/ui/admin.css) | The `c-*` classes, in the `components` cascade layer, reading only tokens |
| [ui/tokens.ts](../frontend/src/ui/tokens.ts) | Typed `var(--we-*)` references for code that needs a value in JS (chart series, inline SVG) |
| [ui/components/](../frontend/src/ui/components/) | `Button`/`IconButton`, `Page`, `PageHeader`, `Card`, `StatCard`, `EmptyState`, `Badge`, `Alert`, `Progress`, `Skeleton`, `ErrorBanner`, `BrandMark`/`Lockup`, `ThemeToggle` |
| [ui/index.ts](../frontend/src/ui/index.ts) | The barrel every page imports as `@/ui` |

Pages import their primitives from `@/ui` and write components with `c-*` classes. Layout and spacing stay Tailwind utilities, but Tailwind's theme is mapped onto the tokens in [app/globals.css](../frontend/src/app/globals.css), so `bg-surface`, `text-secondary`, `border-line`, `rounded-lg` and `shadow-sm` all resolve to `var(--we-*)` and follow dark mode. No page states a colour, size or radius of its own; the repo holds no raw hex or palette class outside `tokens.css`.

Where this differs from the shared description above, and why:

- **`tokens.css` and `admin.css`, not `tokens.ts` and `admin-css.ts`.** Tailwind v4 reads its `@theme` from real CSS at build time, so the tokens and component classes are CSS files that Tailwind imports. `tokens.ts` holds only `var()` references, so no value is written twice.
- **The page container is in the shell.** `.c-page` is applied by [the app layout's `<main>`](<../frontend/src/app/(app)/layout.tsx>), so every page is centred at 1200px and no page can forget step 1. `<Page narrow>` is exported for a page that wants the 880px cap.
- **Tailwind's own `text-*` scale is kept.** Its defaults already equal the system's steps at 12, 14, 16, 18 and 24px; only 13px (secondary) and the unused 20px differ, and the `c-*` classes take their sizes from `--we-font-size-*` directly.
- **The brand mark is the supplied artwork, not a vector.** [ui/assets/logo.jpg](../frontend/src/ui/assets/logo.jpg) is the file as delivered; [ui/assets/logo.png](../frontend/src/ui/assets/logo.png) is the same image with its flat background solved away into a real alpha channel, so it sits cleanly on white and on navy with no fringe. `BrandMark` in [ui/components/logo.tsx](../frontend/src/ui/components/logo.tsx) renders that PNG. The same master produces [app/icon.png](../frontend/src/app/icon.png) (the tab icon), [app/apple-icon.png](../frontend/src/app/apple-icon.png) (the iOS home screen, which composites on black and so carries its own white ground) and [public/logo.png](../frontend/public/logo.png) (transactional email, where SVG is not reliably rendered).
- **The mark is therefore the one thing in the system a token cannot colour.** It carries the logo green in its own pixels. `--we-logo` still records that value for anything else that needs it.
- **The mark keeps the logo green on every background.** At 2.4:1 on white it would fail WCAG 1.4.11, but a brand mark is a logotype and exempt. It is 5.6:1 on the light navy sidebar and 4.1:1 on the dark one.
- **Tokens added here:** `--we-on-primary` and `--we-on-primary-muted` (text on navy), `--we-on-error` (text on the danger fill), `--we-focus-on-primary` (the green ring on navy), `--we-scrim` (dialog and drawer backdrops), `--we-radius-full`, and `--we-size-fab` (56px, the assistant launcher). Two of them need a dark step the shared table does not give: `--we-on-primary-muted` goes to `#AEBBCB`, because the dark navy is lighter than the light one (`#94A3B8` is only 3.9:1 on it), and `--we-rating` goes to `#F59E0B`, because `#B45309` is 3.1:1 on the dark surface.
- **`.c-search` sits on `--we-surface`, not `--we-surface-muted`.** Secondary text is 4.34:1 on the muted surface, which the colour section says to avoid, and the search control's own border already separates it. The inactive label in `.c-segmented` is body rather than secondary for the same reason.
- **`c-fab` and `c-chatbox` carry the AI assistant**, together with a `c-chat-*` family for the bubbles, the suggestions and the confirmation card, and `AgentAvatar` — the assistant's robot face, drawn from `--we-on-primary`, `--we-accent` and `--we-primary` so it follows the theme. The launcher is a navy disc with a ring of `--we-accent` at 50%. See [04-ai-assistant.md](./04-ai-assistant.md).

Dark mode is wired end to end: the toggle cycles system → light → dark, saves the choice per browser, and an inline script in [app/layout.tsx](../frontend/src/app/layout.tsx) applies it before first paint. The font is Inter, self-hosted by `next/font`, with tabular numerals in tables, stats and charts.
