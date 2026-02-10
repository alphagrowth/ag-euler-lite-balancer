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

Configuration is split into two mechanisms:

1. **`useEnvConfig()`** (`composables/useEnvConfig.ts`) — API URLs, Pyth, Reown, wallet screening. Injected at runtime via `server/plugins/app-config.ts` into `window.__APP_CONFIG__`. Accepts both plain names (`EULER_API_URL`) and Doppler-prefixed names (`NUXT_PUBLIC_EULER_API_URL`).

2. **Nuxt `runtimeConfig`** (`useDeployConfig()`) — branding, social links, feature flags. Set via `NUXT_PUBLIC_CONFIG_*` env vars.

3. **Chain config** (`useChainConfig()`) — derived dynamically from `RPC_URL_HTTP_<chainId>` env vars at server startup, injected via `window.__CHAIN_CONFIG__`.

See the [README](../README.md) for the full env var reference.

Dev HTTPS: `HTTPS_KEY`, `HTTPS_CERT` (optional).

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
- If blockchain calls fail, verify `RPC_URL_HTTP_<chainId>` env vars and check that matching `NUXT_PUBLIC_SUBGRAPH_URI_<chainId>` is set.
- If token logos don't load, verify `EULER_API_URL` (or `NUXT_PUBLIC_EULER_API_URL`) is set.

---

_Next: Explore the [Data Flow and Integrations](./data-flow-and-integrations.md) for protocols, APIs, and SDKs used._
