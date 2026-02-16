# Project Structure

This document provides an overview of the Euler Lite project's folder structure, file organization, and naming conventions.

## 📁 Root Directory Structure

```
euler-lite/
├── app.vue                 # Main application entry point
├── nuxt.config.ts          # Nuxt.js configuration
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── eslint.config.mjs       # ESLint configuration
├── Dockerfile              # Docker configuration
├── error.vue               # Global error page
├── abis/                   # Smart contract ABIs
├── assets/                 # Static assets and styles
├── components/             # Vue components
├── composables/            # Vue composables and business logic
├── entities/               # Data models and type definitions
├── pages/                  # Application pages and routing
├── plugins/                # Nuxt.js plugins
├── public/                 # Public static files
├── services/               # Service layer (pricing, etc.)
├── types/                  # Global TypeScript types
└── utils/                  # Utility functions
```

## 🎨 Assets Directory

```
assets/
├── sprite/                 # SVG sprite system
│   ├── gen/                # Generated sprite files
│   └── svg/                # Individual SVG icons
├── styles/                 # Global styles and design system
│   ├── fonts.scss          # Font definitions and imports
│   ├── grid.scss           # CSS Grid system
│   ├── main.scss           # Main stylesheet entry point
│   ├── mixins.scss         # SCSS mixins and functions
│   ├── reset.scss          # CSS reset and base styles
│   ├── transitions.scss    # Animation and transition styles
│   ├── typography.scss     # Typography system
│   └── variables.scss      # CSS custom properties
```

### Style System Architecture

The styling system follows a modular approach:

- **Variables**: Centralized design tokens and configuration
- **Mixins**: Reusable style patterns and functions
- **Grid**: Responsive grid system for layout
- **Typography**: Consistent text styling and hierarchy
- **Transitions**: Smooth animations and state changes

## 🧩 Components Directory

```
components/
├── base/                                            # Base/primitive components
├── entities/                                        # Domain-specific components
│   ├── portfolio/                                   # Portfolio display items
│   └── vault/                                       # Vault-related components
│       ├── discovery/                               # Explore page components
│       │   └── DiscoveryMarketAccordion.vue         # Market group accordion for explore
│       ├── form/                                    # Form and summary components
│       │   ├── SummaryPriceValue.vue                # Price + USD value summary row
│       │   ├── SummaryRow.vue                       # Generic label + value row
│       │   ├── SummaryValue.vue                     # Formatted value display
│       │   └── VaultFormInfoBlock.vue               # Info block wrapper
│       └── overview/                                # Vault detail overview components
├── layout/                                          # Layout and navigation components
└── ui/                                              # UI kit
    ├── modals/
    │   └── UiCustomFilterModal.vue                  # Custom metric filter creation modal
    └── UiCustomFilterChips.vue                      # Active filter chips display
```

### Component Organization Principles

1. **Base Components**: Fundamental, reusable components with minimal dependencies
2. **Entity Components**: Domain-specific components that represent business entities
3. **Layout Components**: Components that define the overall application structure
4. **UI Components**: Reusable interface components with consistent styling

## 🔧 Composables Directory

```
composables/
├── useAddressScreen.ts            # Address screening (compliance)
├── useBrevis.ts                   # Brevis ZK proof rewards integration
├── useChainConfig.ts              # Dynamic chain derivation from RPC_URL_HTTP_* env vars
├── useCustomFilters.ts            # Generic custom metric filter system (gt/lt)
├── useDeployConfig.ts             # Branding, social links, feature flags (from runtimeConfig)
├── useEnvConfig.ts                # Runtime env config (API URLs, Pyth, Reown)
├── useEulerAccount.ts             # Euler account and portfolio positions
├── useEulerAddresses.ts           # Euler contract address resolution
├── useEulerConfig.ts              # Aggregated config for Euler services
├── useEulerLabels.ts              # Euler labels and metadata
├── useEulerOperations.ts          # Euler protocol operations (supply, borrow, etc.)
├── useEstimateFees.ts             # Transaction fee estimation
├── useIntrinsicApy.ts             # Intrinsic APY (DeFi Llama yield data, compounding formula)
├── useMarketGroups.ts             # Market grouping algorithm for explore page
├── useMerkl.ts                    # Merkl rewards campaign fetching
├── useMultiplyCollateralOptions.ts # Multiply collateral selection
├── usePriceBackend.ts             # Backend price service client
├── useREULLocks.ts                # REUL token lock management
├── useRewardsApy.ts               # Unified reward APY aggregation (Merkl + Brevis)
├── useSlippage.ts                 # Swap slippage settings
├── useSwapApi.ts                  # Swap API integration
├── useSwapCollateralOptions.ts    # Swap collateral selection
├── useSwapDebtOptions.ts          # Swap debt selection
├── useSwapQuotesParallel.ts       # Parallel swap quote fetching
├── useTermsOfUseGate.ts           # Terms of use enforcement
├── useTokens.ts                   # Token metadata and resolution
├── useTokenSymbolResolver.ts      # Token symbol resolution
├── useTosData.ts                  # Terms of service data
├── useTxPlanSimulation.ts         # Transaction plan simulation
├── useVaultRegistry.ts            # Vault registry and unknown vault resolution
├── useVaults.ts                   # Vault data management
├── useWagmi.ts                    # Wagmi wallet integration
└── useWallets.ts                  # Wallet balance management
```

### Composable Naming Convention

- **Prefix**: All composables start with `use`
- **Camel Case**: Use camelCase for naming
- **Descriptive**: Names should clearly indicate their purpose
- **Single Responsibility**: Each composable handles one specific concern

## 🏗️ Entities Directory

```
entities/
├── account.ts               # Account-related data models
├── brevis.ts                # Brevis ZK proof types
├── constants.ts             # Shared constants
├── custom.ts                # Theme hue and intrinsic APY data sources
├── evc-error-signatures.ts  # EVC error signature decoding
├── euler/                   # Euler Finance specific entities
├── lend-discovery.ts        # Market group and curator group types (explore page)
├── reward-campaign.ts       # Unified RewardCampaign type (Merkl + Brevis)
│   ├── abis.ts              # Smart contract ABIs
│   └── labels.ts            # Euler labels and metadata types
├── menu.ts                  # Navigation menu configuration
├── merkl.ts                 # Merkl rewards system models
├── oracle.ts                # Oracle decoding and Pyth feed collection
├── oracle-providers.ts      # Oracle provider type definitions
├── permit2.ts               # Permit2 approval types
├── reul.ts                  # REUL token types
├── saHooksSDK.ts            # Smart account hooks builder
├── swap.ts                  # Swap types and utilities
├── token.ts                 # Token data models
├── txPlan.ts                # Transaction plan types (TxPlan, TxStep)
└── vault.ts                 # Vault data models and fetching
```

### Entity Organization

- **Core Entities**: Fundamental data models used throughout the application
- **Protocol Entities**: Specific to blockchain protocols (Euler, EVM)
- **Integration Entities**: Models for external service integrations (rewards, oracles)

## 📄 Pages Directory

```
pages/
├── borrow/                  # Borrow functionality
│   ├── [collateral]/        # Dynamic route for collateral selection
│   │   └── [borrow]/        # Dynamic route for borrow asset
│   │       └── index.vue    # Borrow operation page
│   └── index.vue            # Main borrow page
├── earn/                    # EulerEarn functionality
│   └── [vault]/             # Dynamic route for earn vault
│       ├── index.vue        # Earn vault overview
│       └── withdraw.vue     # Earn withdrawal
├── explore/                 # Market discovery
│   └── index.vue            # Explore page (grouped market view)
├── index.vue                # Landing page (lend)
├── lend/                    # Lend functionality
│   └── [vault]/             # Dynamic route for specific vault
│       ├── index.vue        # Vault overview page
│       ├── swap.vue         # Collateral swap page
│       └── withdraw.vue     # Withdrawal page
├── onboarding.vue           # User onboarding flow
├── portfolio/               # Portfolio management
│   ├── index.vue            # Main portfolio page
│   ├── rewards.vue          # Rewards management
│   └── saving.vue           # Savings overview
├── portfolio.vue            # Legacy portfolio page
├── position/                # Position management
│   └── [number]/            # Dynamic route for position ID
│       ├── borrow/
│       │   ├── index.vue    # Position borrow operations
│       │   └── swap.vue     # Borrow debt swap
│       ├── collateral/
│       │   └── swap.vue     # Collateral swap
│       ├── index.vue        # Position overview
│       ├── multiply.vue     # Multiply position
│       ├── repay.vue        # Position repayment
│       ├── supply.vue       # Position supply operations
│       └── withdraw.vue     # Position withdrawal
└── ui.vue                   # UI component showcase
```

### Page Organization

- **Feature-based**: Pages are organized by application features
- **Dynamic Routes**: Use Nuxt.js dynamic routing for parameterized pages
- **Nested Structure**: Related functionality is grouped together
- **Clear Naming**: Page names reflect their purpose and functionality

## 🔌 Plugins Directory

```
plugins/
├── 00.wagmi.ts              # Wagmi wallet initialization (runs first)
├── 01.query.ts              # Query client initialization
├── directives.ts            # Global Vue directives
├── node.ts                  # Server-side plugins
└── theme.client.ts          # Client-side theme setup
```

### Plugin Types

- **Client-side**: Run only in the browser (e.g., `theme.client.ts`)
- **Universal**: Run in both environments (e.g., `00.wagmi.ts`)

## Server Plugins

```
server/
├── plugins/
│   ├── app-config.ts        # Injects env config into HTML via window.__APP_CONFIG__
│   └── chain-config.ts      # Injects chain config into HTML via window.__CHAIN_CONFIG__
```

These Nitro plugins run at server startup and inject configuration into the rendered HTML so the client can read it synchronously. This enables runtime-injected env vars (e.g., Doppler on Railway) without rebuilding.

## 📝 Types Directory

```
types/
└── index.ts                 # Global TypeScript type definitions
```

### Type Organization

- **Global Types**: Types used across multiple modules
- **Interface Extensions**: Extensions to existing interfaces
- **Utility Types**: Helper types for common patterns

## 🛠️ Utils Directory

```
utils/
├── block-explorer.ts        # Block explorer URL helpers
├── crypto-utils.ts          # Cryptographic utilities
├── evc-converter.ts         # EVC batch/call conversion utilities
├── multicall.ts             # Batch lens calls via EVC simulation
├── pyth.ts                  # Pyth oracle utilities (Hermes API, batch building)
├── string-utils.ts          # String manipulation utilities
├── swapQuotes.ts            # Swap quote formatting
├── time-utils.ts            # Time and date utilities
└── tx-errors.ts             # Transaction error parsing
```

## 📊 Services Directory

```
services/
├── pricing/
│   ├── index.ts             # Pricing module exports
│   ├── backendClient.ts     # Backend price API client (batching, caching)
│   └── priceProvider.ts     # 3-layer pricing system (oracle → USD → values)
├── trm.ts                   # TRM Labs compliance screening
└── vpn.ts                   # VPN detection service
```

## 📋 ABIs Directory

```
abis/
├── brevis.ts                # Brevis contract ABI
├── erc20.ts                 # ERC-20 token ABI
├── evc.ts                   # EVC (Ethereum Vault Connector) ABI
├── merkl.ts                 # Merkl distributor ABI
├── pyth.ts                  # Pyth oracle contract ABI
├── reul.ts                  # REUL token ABI
├── tos.ts                   # Terms of service contract ABI
└── vault.ts                 # Vault and lens contract ABIs
```

### Utility Organization

- **Domain-specific**: Utilities specific to certain domains
- **Generic**: Reusable utility functions
- **Pure Functions**: Stateless, predictable functions

## 📋 File Naming Conventions

### Vue Components

- **PascalCase**: Component names use PascalCase (e.g., `VaultItem.vue`)
- **Descriptive**: Names should clearly indicate the component's purpose
- **Consistent**: Similar components follow consistent naming patterns

### TypeScript Files

- **camelCase**: File names use camelCase (e.g., `useVaults.ts`)
- **Descriptive**: Names should indicate the file's content
- **Consistent**: Similar files follow consistent naming patterns

### SCSS Files

- **kebab-case**: Style files use kebab-case (e.g., `main.scss`)
- **Functional**: Names should indicate the purpose of the styles
- **Modular**: Each file handles a specific aspect of styling

---

_Next: Continue to the [Development Guide](./development-guide.md) for workflows, scripts, and conventions._
