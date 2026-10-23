---
name: "shadcn-ui"
description: "Build beautiful, consistent, accessible UI in the frontend/ SPA with shadcn/ui on its React Aria base, using Tailwind design tokens instead of ad hoc CSS. Activate when creating or restyling any view, form, filter, dialog, table, toast, or empty/loading/error state in frontend/."
---

# shadcn/ui

Use this skill whenever you render something a user sees in `frontend/`. shadcn/ui is not a dependency you import — it is **code the CLI copies into the repo**, which you then own and adapt.

## Why this fits this repo

The SPA is built on `react-aria-components` because accessibility is an acceptance criterion, not a finish. shadcn ships a **React Aria base**, so its components are styled wrappers around the exact primitives already in use.

**Therefore: adopting shadcn adds a visual layer, it does not add a second UI framework.** Behaviour stays with React Aria; shadcn supplies the design tokens, the Tailwind styling, and a coherent look.

Never install the Radix or Base UI variants of a component here — they would be the second framework the architecture forbids.

## Look up before you build (Context7)

shadcn's registry, CLI flags, and component APIs change often. Resolve and fetch docs before non-trivial work.

| Concern | Library ID | Useful topic |
|---|---|---|
| Components, CLI, theming, blocks | `/websites/ui_shadcn` | `installation/vite`, `components/aria/<name>`, `theming`, `components-json`, `dark-mode` |
| Deep component source and examples | `/shadcn-ui/ui` | the specific component |
| Underlying behaviour and ARIA | `/websites/react-aria_adobe` | the primitive the component wraps |

Always read the `components/aria/<name>` page, not `components/<name>`.

## Setup (once, if `components.json` is absent)

```bash
cd frontend
npx shadcn@latest init --base aria
```

This adds Tailwind, `components.json`, the `@/*` path alias in `tsconfig.json` / `tsconfig.app.json` / `vite.config.ts`, the CSS variable theme in `src/index.css`, and `src/lib/utils.ts` with `cn()`.

Keep `tailwind.cssVariables: true`. Token-based theming is what keeps the app visually coherent and themeable; inline colour utilities are not.

## Workflow

1. **Name the UI problem in shadcn's vocabulary** — a refusal is an `alert`, a confirmation is a `toast`, a "no bookings today" state is `empty`, a slow load is `skeleton`.
2. **Check `frontend/src/components/ui` first.** If the component is there, use it. Only run `add` for something genuinely missing.
3. **Add it** — `npx shadcn@latest add <name>` from `frontend/`. Never hand-copy component source from the docs; the CLI wires dependencies and tokens.
4. **Compose, do not fork.** Build the feature component in `frontend/src/components` on top of the `ui/` primitive. `ui/` files stay close to upstream so they can be re-added.
5. **Verify** — keyboard walk the flow, confirm focus is visible, then `npm run typecheck && npm run lint` in `frontend/`.

## Core Rules

### Tokens, never raw colour

- Use semantic tokens: `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`, `bg-destructive`, `ring-ring`.
- Never write a hex value, a `bg-red-500`, or an inline `style` colour in a component. If a needed colour has no token, add the token to `index.css` for **both** light and dark, then use it.
- Every surface must be legible in dark mode. If you set a foreground, set its matching background token.

### Beauty is spacing and hierarchy, not decoration

- Spacing comes from the 4px Tailwind scale — `gap-2`, `gap-4`, `p-6`. Do not invent arbitrary values like `p-[13px]`.
- One clear hierarchy per screen: `Card` for grouping, `CardHeader`/`CardTitle`/`CardDescription` for the frame, `Separator` between logical sections.
- Exactly one `default` (primary) button per view; everything else is `secondary`, `outline`, or `ghost`. Cancellation is `variant="destructive"`.
- Prefer `size="sm"` density for data-heavy views such as the day schedule; keep the primary booking action full size.
- Use `Badge` for booking status, `Skeleton` for loading, `Empty` for empty states. Do not render bare "Loading…" text.

### Merge classes with `cn()`

Accept a `className` prop on every reusable component and merge with `cn(...)` from `@/lib/utils`, so a caller can adjust layout without a wrapper `div` or a `!important`.

### Accessibility still wins over aesthetics

- Never remove the focus ring. If it clashes, restyle it with `ring-*` tokens — do not `outline-none` it away.
- Never convey booking state, a validation failure, or a 409 clash by colour alone. Pair every colour with text and an icon, and keep the announcement (`role="alert"` / live region) that the primitive provides.
- Icons alone are not labels. A `size="icon"` button needs an accessible name (`aria-label` or visually hidden text).
- Do not strip a shadcn wrapper's ARIA wiring while restyling it; that wiring is the React Aria contract.

### Forms

- Wire shadcn field components to React Hook Form via the shadcn `Form` / field pattern so `aria-invalid` and `aria-describedby` stay generated, not hand-written.
- Render server messages in `FormMessage`; do not invent a parallel error surface.

## Non-Negotiables

- No Radix or Base UI shadcn variant in this repo — React Aria base only.
- No hex codes, no `bg-<palette>-<n>` colour utilities, no arbitrary spacing values.
- No hand-copied component source when `npx shadcn@latest add` can install it.
- No edits to `components/ui/*` beyond what the feature genuinely requires; feature styling belongs in the feature component.
- No removed focus ring, no colour-only state, no unlabelled icon button.

## Done When

- [ ] Every visual element uses semantic tokens and the Tailwind spacing scale
- [ ] The view is legible and correct in both light and dark mode
- [ ] Exactly one primary action; destructive actions use the destructive variant
- [ ] Loading, empty, and error states use `Skeleton` / `Empty` / `Alert` rather than bare text
- [ ] Focus is visible throughout and the flow is keyboard-operable
- [ ] `components/ui/*` remains close to upstream and re-addable
- [ ] `npm run typecheck` and `npm run lint` pass in `frontend/`
