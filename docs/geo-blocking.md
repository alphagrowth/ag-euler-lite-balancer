# Geo-Blocking

This document explains how Euler Lite restricts vault access based on the user's geographic location, covering country detection, blocking rules, per-vault overrides, and UI enforcement.

## Overview

Certain jurisdictions are prohibited from interacting with specific vaults (or all vaults) due to regulatory requirements. The geo-blocking system:

1. Detects the user's country from an HTTP response header.
2. Evaluates blocking rules at three levels: global sanctions, product-level blocks, and per-vault overrides.
3. Prevents blocked users from submitting transactions while still showing blocked vaults in the UI (dimmed, with a "Restricted" chip).

Users with existing positions in newly-blocked vaults can still view and withdraw, but cannot open new positions or perform other operations.

## Country Detection

**File**: `services/country.ts`

The user's country is detected by sending a `HEAD` request to the application's origin and reading the `x-country-code` response header (set by the CDN/reverse proxy). The result is normalized to uppercase ISO 3166-1 alpha-2 (e.g. `US`, `DE`, `GB`).

Detection is cached for 5 minutes to avoid repeated network calls. On failure, `null` is cached (the user is not blocked when detection fails).

```
Browser → HEAD / → CDN returns x-country-code: DE → stored as "DE"
```

**Initialization**: `app.vue` calls `useGeoBlock().loadCountry()` on startup. The detected country is stored in a module-level `ref` in `composables/useGeoBlock.ts`, making it available to all blocking checks synchronously after initial load.

## Blocking Rules

**File**: `composables/useGeoBlock.ts`

The function `isVaultBlockedByCountry(vaultAddress)` evaluates three layers in order:

### 1. Sanctioned Countries (Global Block)

Defined in `entities/constants.ts` as `SANCTIONED_COUNTRIES`. Users from these countries are blocked from **all** vaults unconditionally:

```
AF, CF, CU, KP, CD, ET, IR, IQ, LB, LY, ML, MM, NI, RU, SO, SS, SD, SY, VE, YE, ZW
```

This list is checked first. If the user's country matches, the function returns `true` immediately without checking product or vault-level blocks.

### 2. Product-Level Blocks

Each product in `products.json` (from the euler-labels repo) can have a `block` array of country codes or group aliases:

```json
{
  "name": "Example Vault",
  "vaults": ["0x1234..."],
  "block": ["US", "EU"]
}
```

All vaults listed under that product inherit the block list. The function `getVaultBlock(address)` in `useEulerLabels.ts` resolves this.

### 3. Per-Vault Overrides

A product can override blocking rules for individual vaults via `vaultOverrides`:

```json
{
  "name": "Example Product",
  "vaults": ["0xAAA...", "0xBBB..."],
  "block": ["US"],
  "vaultOverrides": {
    "0xBBB...": {
      "block": ["US", "EU", "CH"]
    }
  }
}
```

When a vault has an override with a `block` field, the override **replaces** (not merges with) the product-level block list. In the example above, `0xAAA` is blocked for `US` only, while `0xBBB` is blocked for `US`, `EU`, and `CH`.

### 4. Earn Vault Blocks

Earn vaults have a separate blocking mechanism in `earn-vaults.json`. Entries can be a plain address string (no blocking) or an object with a `block` array:

```json
[
  "0x1111...",
  { "address": "0x2222...", "block": ["EU", "CH"] }
]
```

These are stored in a dedicated `earnVaultBlocks` map (keyed by lowercase address) and checked by `getEarnVaultBlock(address)`.

## Country Groups

**File**: `entities/constants.ts`

Block lists can reference group aliases instead of individual country codes. The `expandBlockList()` function in `useGeoBlock.ts` resolves these before matching:

| Alias | Expansion | Count |
|-------|-----------|-------|
| `EU` | All 27 EU member states (AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE) | 27 |
| `EEA` | EU + IS, LI, NO | 30 |
| `EFTA` | IS, LI, NO, CH | 4 |

Group aliases can be mixed with individual codes: `["EU", "CH", "US"]` blocks all EU countries plus Switzerland and the US.

## Helper Functions

### `isVaultBlockedByCountry(address): boolean`

The core check. Returns `true` if the vault is blocked for the detected country.

### `isAnyVaultBlockedByCountry(...addresses): boolean`

Returns `true` if **any** of the provided vault addresses are blocked. Used on action pages that involve multiple vaults (e.g. a borrow position has both a collateral vault and a borrow vault).

### `getVaultTags(address): { tags: string[], disabled: boolean }`

Combines geo-blocking and deprecation status into a single result for UI consumption. Returns tags like `["Restricted"]`, `["Deprecated"]`, or `["Restricted", "Deprecated"]`. Sets `disabled: true` when any tag is present. Used in vault selection modals (`ChooseCollateralModal`) to show warning chips and prevent selection.

## UI Enforcement

The geo-block status surfaces in four layers of the UI:

### Browse Pages (`/lend`, `/earn`, `/borrow`)

Vault cards (`VaultItem.vue`, `VaultEarnItem.vue`, `VaultBorrowItem.vue`) show a yellow "Restricted" chip and reduce the card opacity to 50%. The vault remains visible and clickable (the user can view details) but cannot perform operations from the detail page.

```vue
<span v-if="isGeoBlocked" class="... bg-warning-100 text-warning-500 text-p5">
  <SvgIcon name="warning" />
  Restricted
</span>
```

### Vault Detail Pages (`/lend/[vault]`, `/earn/[vault]`)

A warning toast is displayed at the top of the page:

```
"This operation is not available in your region. You can still withdraw existing deposits."
```

The submit/review button is disabled via `getSubmitDisabled()`.

### Selection Modals (`ChooseCollateralModal`)

When swapping collateral or debt, blocked/deprecated vaults appear in the selection list with:
- `opacity-50` and `cursor-not-allowed` styling
- Warning chips ("Restricted", "Deprecated") matching the browse page styling
- Click handler disabled — the user cannot select them

### Action Pages (Supply, Borrow, Withdraw, Repay, Multiply)

Each action page computes an `isGeoBlocked` flag:

```typescript
// Single vault check
const isGeoBlocked = computed(() => isVaultBlockedByCountry(vaultAddress))

// Multi-vault check (borrow page: collateral + borrow vaults)
const isGeoBlocked = computed(() => isAnyVaultBlockedByCountry(collateralAddress, borrowAddress))
```

When blocked:
- The review/submit button is disabled
- The `submit()` function has an early return guard
- A warning toast explains the restriction

### Portfolio Pages

Existing positions in blocked vaults show the "Restricted" chip (`PortfolioSavingItem`, `PortfolioEarnItem`, `PortfolioBorrowItem`) so the user understands why operations may be limited.

## Data Flow

```
App Startup
  │
  ├─ loadCountry() ─► HEAD request ─► x-country-code header ─► country ref ("DE")
  │                                                              (5-min cache)
  │
  └─ loadLabels() ──► euler-labels GitHub repo ─► products.json ─► product.block
                                                                    product.vaultOverrides[addr].block
                                                 ► earn-vaults.json ─► earnVaultBlocks map
                                                   (5-min cache)

Runtime Check: isVaultBlockedByCountry("0x1234...")
  │
  ├─ 1. SANCTIONED_COUNTRIES includes "DE"?  ─► yes → blocked
  │
  ├─ 2. getVaultBlock("0x1234...")
  │     └─ product.vaultOverrides["0x1234..."]?.block ?? product.block
  │     └─ expandBlockList(codes) → includes "DE"?  ─► yes → blocked
  │
  ├─ 3. getEarnVaultBlock("0x1234...")
  │     └─ earnVaultBlocks[lowercase addr]
  │     └─ expandBlockList(codes) → includes "DE"?  ─► yes → blocked
  │
  └─ 4. Not blocked → return false
```

## Configuration

All blocking configuration lives outside the app codebase:

| What | Where | Effect |
|------|-------|--------|
| Global sanctions list | `entities/constants.ts` — `SANCTIONED_COUNTRIES` | Blocks all vaults for listed countries |
| Country group definitions | `entities/constants.ts` — `COUNTRY_GROUPS` | Defines EU, EEA, EFTA aliases |
| Product-level blocks | `euler-labels` repo — `products.json` `block` field | Blocks all vaults in a product |
| Per-vault overrides | `euler-labels` repo — `products.json` `vaultOverrides[addr].block` | Overrides product block for one vault |
| Earn vault blocks | `euler-labels` repo — `earn-vaults.json` `block` field | Blocks specific earn vaults |

Changes to `products.json` or `earn-vaults.json` in the euler-labels repo take effect within 5 minutes (the label cache TTL) without any app deployment.

## Key Files

| File | Role |
|------|------|
| `services/country.ts` | Country detection from `x-country-code` header |
| `composables/useGeoBlock.ts` | Core blocking logic, `isVaultBlockedByCountry`, `getVaultTags` |
| `composables/useEulerLabels.ts` | Label fetching, `getVaultBlock`, `getEarnVaultBlock` |
| `entities/constants.ts` | `SANCTIONED_COUNTRIES`, `COUNTRY_GROUPS` (EU/EEA/EFTA) |
| `entities/euler/labels.ts` | TypeScript types (`EulerLabelProduct`, `EulerLabelVaultOverride`) |
| `components/entities/vault/VaultItem.vue` | Browse page "Restricted" chip |
| `components/entities/vault/ChooseCollateralModal.vue` | Selection modal disabled state and warning chips |
