# Project Structure

This document provides an overview of the Euler TMA project's folder structure, file organization, and naming conventions.

## 📁 Root Directory Structure

```
eulertma/
├── app.vue                 # Main application entry point
├── nuxt.config.ts          # Nuxt.js configuration
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── eslint.config.mjs       # ESLint configuration
├── Dockerfile              # Docker configuration
├── error.vue               # Global error page
├── assets/                 # Static assets and styles
├── components/             # Vue components
├── composables/            # Vue composables and business logic
├── entities/               # Data models and type definitions
├── pages/                  # Application pages and routing
├── plugins/                # Nuxt.js plugins
├── public/                 # Public static files
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
├── entities/                                        #
├── layout/                                          # Layout and navigation components
└── ui/                                              # UI kit
```

### Component Organization Principles

1. **Base Components**: Fundamental, reusable components with minimal dependencies
2. **Entity Components**: Domain-specific components that represent business entities
3. **Layout Components**: Components that define the overall application structure
4. **UI Components**: Reusable interface components with consistent styling

## 🔧 Composables Directory

```
composables/
├── useAppConfig.ts          # Configuration management
├── useEulerAccount.ts       # Euler account operations
├── useEulerLabels.ts        # Euler labels and metadata
├── useEulerOperations.ts    # Euler protocol operations
├── useMerkl.ts              # Merkl rewards system
├── useOperationTracker.ts   # Operation tracking and monitoring
├── useTacSdk.ts             # TAC SDK integration
├── useTonConnect.ts         # TON wallet connection
├── useVaults.ts             # Vault data management
└── useWallets.ts            # Wallet balance management
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
├── assets.ts                # Asset definitions and utilities
├── config.ts                # Configuration constants and addresses
├── euler/                   # Euler Finance specific entities
│   ├── abis.ts              # Smart contract ABIs
│   ├── addresses.ts         # Contract addresses by network
│   └── labels.ts            # Euler labels and metadata
├── merkl.ts                 # Merkl rewards system models
├── saHooksSDK.ts            # Smart account hooks
└── vault.ts                 # Vault data models and operations
```

### Entity Organization

- **Core Entities**: Fundamental data models used throughout the application
- **Protocol Entities**: Specific to blockchain protocols (Euler, TON)
- **Integration Entities**: Models for external service integrations

## 📄 Pages Directory

```
pages/
├── borrow/                  # Borrow functionality
│   ├── [collateral]/        # Dynamic route for collateral selection
│   │   └── [borrow]/        # Dynamic route for borrow asset
│   │       └── index.vue    # Borrow operation page
│   └── index.vue            # Main borrow page
├── index.vue                # Landing page (lend)
├── lend/                    # Lend functionality
│   └── [vault]/             # Dynamic route for specific vault
│       ├── index.vue        # Vault overview page
│       └── withdraw.vue     # Withdrawal page
├── metrics.vue              # Analytics and metrics page
├── onboarding.vue           # User onboarding flow
├── portfolio/               # Portfolio management
│   ├── index.vue            # Main portfolio page
│   ├── rewards.vue          # Rewards management
│   └── saving.vue           # Savings overview
├── portfolio.vue            # Legacy portfolio page
├── position/                # Position management
│   └── [number]/            # Dynamic route for position ID
│       ├── borrow.vue       # Position borrow operations
│       ├── index.vue        # Position overview
│       ├── repay.vue        # Position repayment
│       ├── supply.vue       # Position supply operations
│       └── withdraw.vue     # Position withdrawal
├── toast-demo.vue           # Toast notification demo
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
├── directives.ts             # Global Vue directives
├── node.ts                  # Server-side plugins
└── webapp.client.ts         # Client-side plugins
```

### Plugin Types

- **Client-side**: Run only in the browser
- **Server-side**: Run on the server (if SSR were enabled)
- **Universal**: Run in both environments

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
├── string-utils.ts          # String manipulation utilities
├── time-utils.ts            # Time and date utilities
└── ton-utils.ts             # TON blockchain utilities
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
