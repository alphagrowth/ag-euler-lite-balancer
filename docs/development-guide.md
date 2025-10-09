# Development Guide

This guide covers the concrete steps and scripts needed to work on this repository.

## Prerequisites

- Node.js 18+
- npm (or yarn/pnpm if you prefer)

## Install and run

```bash
npm install
npm run dev
```

Available scripts (from `package.json`):

- `dev` – start Nuxt in development
- `build` – production build
- `preview` – preview the production build
- `generate` – generate static site
- `postinstall` – `nuxt prepare`

## Project configuration

- Nuxt config: `nuxt.config.ts`
  - Modules, SSR disabled, CSS, SVG sprite, runtimeConfig, dev server HTTPS, Vite SCSS additionalData.
- TypeScript config: `tsconfig.json`
- ESLint config: `eslint.config.mjs`

## Environment variables

Declared and consumed via `nuxt.config.ts` runtimeConfig and `entities/config.ts`. Typical public values:

- `NETWORK` – `testnet` or `mainnet`
- `TGA_TOKEN`, `TGA_NAME` – analytics (optional)
- Dev HTTPS: `HTTPS_KEY`, `HTTPS_CERT` (optional)

Other integration constants (Goldsky, TAC, Euler, Merkl, TON Center, etc.) are defined per-network in `entities/config.ts`.

## Code layout (high level)

- App entry: `app.vue`
- Pages: `pages/*`
- Components: `components/*`
- Composables: `composables/*`
- Entities (types/helpers/ABI/addresses): `entities/*`
- Public assets: `public/*`
- Styles: `assets/styles/*`

## Conventions

- Vue 3 + Nuxt 3 with Composition API.
- Composables named as `useXxx.ts` and colocated in `composables/`.
- Prefer referencing on-chain data via helpers in `entities/` and state via `composables/`.

## Troubleshooting

- If the app fails to start, ensure Node 18+ and reinstall deps.
- If blockchain calls fail, verify `NETWORK` and endpoints in `entities/config.ts`.
- For TON wallet issues, check `public/tonconnect-manifest.json` and `useTonConnect.ts`.

---

_Next: Explore the [Data Flow and Integrations](./data-flow-and-integrations.md) for protocols, APIs, and SDKs used._
