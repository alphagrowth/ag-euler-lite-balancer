# Pricing System Architecture

This document describes the pricing system in euler-lite, including how prices are fetched, converted to USD, and how Pyth oracles are handled.

## Overview

The pricing system is built as a 3-layer architecture that separates concerns between raw oracle data, USD conversion, and value calculation.

## Price Sources: On-Chain vs Off-Chain

The pricing functions support two price sources:

| Source | Description | Use Case |
|--------|-------------|----------|
| `'on-chain'` (default) | Uses on-chain oracle data only | Health factor, LTV, liquidation calculations |
| `'off-chain'` | Tries backend first, falls back to on-chain | Display values, portfolio totals, UI |

**Key insight**: The UoA rate can safely use off-chain pricing even in calculations that mix on-chain oracle prices. Since UoA is a common denominator (both collateral and borrow prices are quoted in UoA), using an off-chain UoA rate doesn't affect health factor/LTV ratios - it only changes the USD display values.

### Backend Configuration

Configure the backend URL in `entities/config.ts`:

```typescript
export default {
  mainnet: {
    PRICE_BACKEND_URL: 'https://api.example.com/prices', // Empty = disabled
    // ...
  }
}
```

Use `usePriceBackend()` composable to access the configuration:

```typescript
const { backendConfig, isBackendEnabled } = usePriceBackend()

// Pass to price functions
const price = await getAssetUsdPrice(vault, 'off-chain', backendConfig.value)
```

### Price Source Usage in Codebase

#### On-Chain Only (Layer 1 - Synchronous)

These functions are **always on-chain** and used for **liquidation-sensitive calculations**:

| Function | Purpose | Used For |
|----------|---------|----------|
| `getAssetOraclePrice()` | Raw oracle price in UoA | Health factor, LTV calculations |
| `getCollateralOraclePrice()` | Collateral price in UoA | Health factor, max borrow calculations |

**Locations using on-chain oracle prices:**
- Borrow page (`pages/borrow/`) - LTV slider, max borrow calculations
- Position pages (`pages/position/`) - Health factor, max withdraw constraints
- Account composable (`composables/useEulerAccount.ts`) - Account health calculation
- Vault overview components - Display oracle price (informational)

#### Off-Chain Preferred (Layer 2/3 - Async)

All display-only USD values use **`'off-chain'`** source:

| Function | Purpose | Call Count |
|----------|---------|------------|
| `getAssetUsdValue()` | USD value of asset amount | 60+ calls |
| `getCollateralUsdValue()` | USD value of collateral | 12+ calls |
| `getAssetUsdPrice()` | Asset price in USD | 4 calls |
| `getCollateralUsdPrice()` | Collateral price in USD | 5 calls |
| `formatAssetValue()` | Format + USD value | 20+ calls |
| `getUnitOfAccountUsdRate()` | UoA→USD rate | Used internally |

**Use cases for off-chain prices:**
- **Portfolio totals** - `totalSuppliedValue`, `totalBorrowedValue`, position values
- **Vault list pages** - TVL, available liquidity in USD
- **Vault detail pages** - Monthly earnings, deposit values
- **Position management** - Supply/borrow value displays (informational)
- **Transaction forms** - Live USD conversion below input fields
- **Vault cards/items** - TVL, liquidity, balance displays

#### Design Decision Summary

| Calculation Type | Source | Rationale |
|-----------------|--------|-----------|
| Health factor | On-chain | Must match protocol's liquidation logic |
| Max borrow/withdraw | On-chain | Safety-critical limits |
| LTV slider | On-chain | User expectations match protocol |
| USD displays | Off-chain | Better UX, backend can have more price feeds |
| Portfolio values | Off-chain | Display only, no safety impact |

## Architecture: 3-Layer System

```
┌─────────────────────────────────────────────────────────────┐
│                    Layer 3: USD Values                       │
│  getAssetUsdValue(), getCollateralUsdValue(), formatAssetValue() │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Layer 2: USD Prices                        │
│        getAssetUsdPrice(), getCollateralUsdPrice()           │
│                                                              │
│   Routes based on vault type:                                │
│   • Earn/Escrow/Securitize → assetPriceInfo (already USD)   │
│   • Regular EVK → oraclePrice × unitOfAccountRate           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Layer 1: Raw Oracle Prices (UoA)               │
│    getAssetOraclePrice(), getCollateralOraclePrice()        │
│    getUnitOfAccountUsdRate()                                │
│                                                              │
│   Sources:                                                   │
│   • liabilityPriceInfo - vault's asset price in UoA         │
│   • collateralPrices[] - collateral prices in UoA           │
│   • unitOfAccountPriceInfo - UoA→USD conversion rate        │
└─────────────────────────────────────────────────────────────┘
```

## Price Data Sources in Vault Object

| Field | Source | Description |
|-------|--------|-------------|
| `liabilityPriceInfo` | VaultLens `getVaultInfoFull()` | Asset price in vault's unit of account |
| `collateralPrices[]` | VaultLens `getVaultInfoFull()` | Collateral prices from liability vault's perspective |
| `unitOfAccountPriceInfo` | UtilsLens `getAssetPriceInfo()` | UoA → USD conversion (fetched separately) |
| `assetPriceInfo` | UtilsLens `getAssetPriceInfo()` | Direct USD price (for Earn/Escrow/Securitize) |

## Key Functions

### Layer 1: Raw Oracle Prices

Located in `services/pricing/priceProvider.ts`:

- **`getAssetOraclePrice(vault)`** - Returns the vault's asset price in its unit of account from `liabilityPriceInfo` (always on-chain, synchronous)
- **`getCollateralOraclePrice(liabilityVault, collateralVault)`** - Returns collateral asset price in the liability vault's unit of account, converting from share price to asset price (always on-chain, synchronous)
- **`getUnitOfAccountUsdRate(vault, source?, backend?)`** - Returns the UoA → USD conversion rate. Returns `1e18` if UoA is USD. Supports off-chain pricing with on-chain fallback (async). Since UoA is a common denominator, using off-chain rates doesn't affect health factor/LTV ratios - only USD display values.

### Layer 2: USD Prices

- **`getAssetUsdPrice(vault)`** - Routes based on vault type:
  - Earn/Escrow/Securitize vaults: Returns `assetPriceInfo` directly (already in USD)
  - Regular EVK vaults: Returns `oraclePrice × uoaRate`

- **`getCollateralUsdPrice(liabilityVault, collateralVault)`** - Returns collateral price in USD using the liability vault's oracle and UoA rate

### Layer 3: USD Values

- **`getAssetUsdValue(amount, vault)`** - Calculates USD value of an asset amount
- **`getCollateralUsdValue(amount, liabilityVault, collateralVault)`** - Calculates USD value of collateral in borrow context
- **`formatAssetValue(amount, vault)`** - Formats value for UI display with price availability flag

## USD Price Calculation for Regular EVK Vault

```typescript
getAssetUsdPrice(vault, source, backend):
  1. If source='off-chain' and backend configured:
     - Try backend for direct asset USD price
     - If available, return backend price

  2. Oracle calculation (fallback or primary if source='on-chain'):
     a. oraclePrice = vault.liabilityPriceInfo.amountOutMid  // Always on-chain
     b. uoaRate = await getUnitOfAccountUsdRate(vault, source, backend)
        - If source='off-chain': tries backend first, falls back to on-chain
        - Returns 1e18 if vault.unitOfAccount === USD_ADDRESS
     c. return (oraclePrice × uoaRate) / 1e18
```

**Note on UoA Rate**: The UoA rate can come from backend even when the asset oracle price is on-chain. Since UoA is a common denominator (both collateral and borrow prices use the same UoA), using an off-chain UoA rate doesn't affect health factor/LTV ratios - only the USD display values.

## Collateral Price Calculation (Borrow Context)

**Key principle: Collateral prices are ALWAYS from the liability vault's perspective.**

When vault A (liability) accepts vault B (collateral), the price of B is determined by vault A's oracle router, NOT vault B's own oracle. This ensures consistent pricing within a borrow position.

```typescript
getCollateralUsdPrice(liabilityVault, collateralVault, source, backend):
  1. If source='off-chain' and backend configured:
     - Try backend for direct collateral USD price
     - If available, return backend price

  2. Oracle calculation (fallback or primary if source='on-chain'):
     a. sharePrice = liabilityVault.collateralPrices.find(collateralVault.address)
     b. assetPrice = sharePrice × (totalShares / totalAssets)  // Convert share→asset
     c. uoaRate = await getUnitOfAccountUsdRate(liabilityVault, source, backend)
        // Use LIABILITY's UoA - can come from backend for 'off-chain' source
     d. return (assetPrice × uoaRate) / 1e18
```

## EulerRouter Oracle Configuration

Most EVK vaults use an EulerRouter as their oracle. The router's `oracleDetailedInfo` contains the complete configuration for ALL pricing pairs the vault needs:

```typescript
type EulerRouterInfo = {
  governor: Address
  fallbackOracle: Address
  fallbackOracleInfo: OracleDetailedInfo
  bases: Address[]                    // All base assets (liability + all collaterals)
  quotes: Address[]                   // All quote assets (typically unit of account)
  resolvedAssets: Address[][]
  resolvedOracles: Address[]
  resolvedOraclesInfo: OracleDetailedInfo[]  // Oracle config for EACH (base, quote) pair
}
```

This means when we decode a vault's `oracleDetailedInfo`:
- `bases[]` contains the liability asset AND all accepted collateral assets
- `resolvedOraclesInfo[]` contains the oracle configuration for each pricing pair
- The full oracle tree (including nested Pyth oracles) is available for traversal

## Pyth Oracle Handling

### The Problem

Unlike Chainlink oracles that maintain on-chain prices, Pyth oracles require explicit price updates via `updatePriceFeeds()` before they can be queried. When the on-chain Pyth price is stale (past `maxStaleness`), the VaultLens query returns `queryFailure: true` and no valid price.

### The Solution

Since Pyth prices are only valid for ~2 minutes after on-chain update, the system **always refreshes** when Pyth oracles are detected (not just on price failure). This is implemented using EVC `batchSimulation` to simulate Pyth price updates alongside lens calls:

1. **Detection**: `collectPythFeedIds()` extracts ALL Pyth feed IDs from `vault.oracleDetailedInfo`
2. **Simulation**: `executeLensWithPythSimulation()` bundles Pyth updates with any lens call (vault or account)
3. **Always Refresh**: When Pyth is detected, always fetch fresh data rather than using cached values

### Why This Works for Collaterals Too

The `collectPythFeedIds()` function recursively traverses the entire oracle configuration:

```typescript
if (info.name === 'EulerRouter') {
  const decoded = decodeEulerRouterInfo(info.oracleInfo)
  visit(decoded.fallbackOracleInfo, depth + 1)
  decoded.resolvedOraclesInfo?.forEach(child => visit(child, depth + 1))  // ALL pairs!
}
```

Since `resolvedOraclesInfo` contains oracle configs for ALL (base, quote) pairs in the router (including collateral pricing), ALL Pyth feeds get collected - not just the liability asset's feed. This ensures that when we refresh a vault via Pyth simulation:

1. Pyth feeds for the liability asset are refreshed → `liabilityPriceInfo` is fresh
2. Pyth feeds for collateral pricing are ALSO refreshed → `collateralPrices[]` is fresh

### Pyth Handling Flow

**Vault Fetching (pages like /lend, /borrow):**
```
fetchVault(vaultAddress) called
                ↓
        Standard query first
    (getVaultInfoFull - fast path)
                ↓
    collectPythFeedIds() checks
    vault.oracleDetailedInfo
                ↓
        ┌───────┴───────┐
        │ Pyth detected? │
        └───────┬───────┘
           No   │   → Return vault as-is
                ↓ Yes
    ALWAYS re-query with simulation
    (Pyth prices only valid ~2 min)
                ↓
    fetchVaultWithPythSimulation():
    1. Fetch fresh prices from Hermes API
    2. Build Pyth updatePriceFeeds() batch items
    3. Build getVaultInfoFull() batch item
    4. Execute EVC batchSimulation
    5. Return fresh vault data
```

**Portfolio/Account Loading (useEulerAccount.ts):**
```
updateBorrowPositions() called
                ↓
    For each borrow position:
    Pre-fetch vault via getOrFetch()
                ↓
    collectPythFeedIds() checks
    vault.oracleDetailedInfo
                ↓
        ┌───────┴───────┐
        │ Pyth detected? │
        └───────┬───────┘
           Yes  │  No → Direct accountLens.getAccountInfo()
                ↓
    executeLensWithPythSimulation():
    1. Build Pyth update batch items
    2. Build getAccountInfo() batch item
    3. Execute EVC batchSimulation
    4. Get fresh account data with updated prices
                ↓
    hasPythOracles(borrow) check
                ↓
           Yes  │  No → Use cached vault
                ↓
    fetchVault() for FRESH borrow vault
    (Refreshes BOTH liabilityPriceInfo AND
     collateralPrices[] - see "Why This Works
     for Collaterals Too" section above)
```

Note: We only refresh the BORROW vault, not the collateral vault. Collateral prices come from `borrow.collateralPrices[]`, which are refreshed when we fetch the borrow vault. The collateral vault only provides `totalAssets`/`totalShares` for share→asset conversion, which aren't affected by Pyth.

### Key Implementation Details

**Reusable Pyth Simulation Helper (`utils/pyth.ts`):**
```typescript
// Generic helper for ANY lens call with Pyth simulation
export const executeLensWithPythSimulation = async <T>(
  feeds: PythFeed[],
  lensContract: ethers.Contract,
  lensMethod: string,
  lensArgs: unknown[],
  evcAddress: string,
  provider: ethers.JsonRpcProvider,
  providerUrl: string,
  hermesEndpoint: string,
): Promise<T | undefined> => {
  // 1. Build Pyth update batch items
  const { items: pythItems, totalFee } = await buildPythBatchItemsFromFeeds(...)

  // 2. Build lens batch item
  const lensBatchItem = { targetContract, data: encodedCall, ... }

  // 3. Execute batch simulation
  const [batchResults] = await evcContract.batchSimulation.staticCall(
    [...pythItems, lensBatchItem],
    { value: totalFee },
  )

  // 4. Return decoded lens result
  return lensContract.interface.decodeFunctionResult(lensMethod, lensResult.result)
}
```

**fetchVault() in `entities/vault.ts`:**
```typescript
// 1. Standard query first (fast path)
const raw = await vaultLensContract.getVaultInfoFull(vaultAddress)
let vault = processRawVaultData(raw, ...)

// 2. Check if Pyth AND has price failure
const feeds = collectPythFeedIds(vault.oracleDetailedInfo)
const hasPythPriceFailure = feeds.length > 0 && (
  vault.liabilityPriceInfo?.queryFailure ||
  !vault.liabilityPriceInfo?.amountOutMid ||
  vault.liabilityPriceInfo.amountOutMid === 0n
)

// 3. Re-query with simulation if failure detected
if (hasPythPriceFailure && evc && PYTH_HERMES_URL) {
  vault = await fetchVaultWithPythSimulation(...) || vault
}
```

**Portfolio Loading (`composables/useEulerAccount.ts`):**
```typescript
// Helper to detect Pyth oracles
const hasPythOracles = (vault: Vault): boolean => {
  const feeds = collectPythFeedIds(vault.oracleDetailedInfo)
  return feeds.length > 0
}

// In updateBorrowPositions():
// 1. Use Pyth simulation for account lens if Pyth detected
if (canUsePythSimulation) {
  const result = await executeLensWithPythSimulation(
    pythFeeds, accountLensContract, 'getAccountInfo', ...
  )
  res = result[0]
}

// 2. ALWAYS fetch fresh borrow vault when Pyth detected (valid only ~2 min)
// This refreshes BOTH liabilityPriceInfo AND collateralPrices[]
if (hasPythOracles(borrow)) {
  const freshBorrow = await fetchVault(borrowAddress)
  if (freshBorrow) borrow = freshBorrow
}

// Note: No need to refresh collateral vault - collateral prices come from
// borrow.collateralPrices[], already refreshed above
```

### EVC batchSimulation Usage

```typescript
// Build batch items
const batchItems = [
  ...pythUpdateBatchItems,  // Pyth price updates
  vaultLensBatchItem,       // getVaultInfoFull() call
]

// Execute simulation
const [batchResults] = await evcContract.batchSimulation.staticCall(
  batchItems,
  { value: totalPythFee },
)

// Last result contains vault data
const vaultLensResult = batchResults[batchResults.length - 1]
const decoded = vaultLensContract.interface.decodeFunctionResult(
  'getVaultInfoFull',
  vaultLensResult.result,
)
```

## Vault Type Routing

The pricing system handles different vault types:

| Vault Type | Price Source | Notes |
|------------|--------------|-------|
| Regular EVK | `liabilityPriceInfo` + UoA conversion | Standard oracle-based pricing |
| Earn | `assetPriceInfo` | UtilsLens provides USD price directly |
| Escrow | `assetPriceInfo` | UtilsLens provides USD price directly |
| Securitize | `assetPriceInfo` | UtilsLens provides USD price directly |

Detection logic in `priceProvider.ts`:
```typescript
const usesUtilsLensPricing = (vault): boolean => {
  return isEarnVault(vault) || isEscrowVault(vault) || isSecuritizeVault(vault)
}
```

## Design Principles

1. **Collateral prices from liability vault's perspective** - Collateral is always priced using the liability vault's oracle router, ensuring consistent pricing within a borrow position
2. **No hardcoded fallbacks** - If a price cannot be determined, return `undefined` rather than assuming values
3. **Pyth handled via simulation** - Fresh prices are obtained through EVC batch simulation, not fallbacks
4. **Complete oracle traversal** - When refreshing Pyth prices, ALL feeds in the oracle configuration are updated (liability AND collaterals)
5. **Layered architecture** - Clear separation between raw oracle data, USD conversion, and value calculation
6. **Vault type awareness** - Different vault types route to appropriate price sources

## Files

- `services/pricing/priceProvider.ts` - Core pricing functions (Layers 1-3)
- `entities/vault.ts` - Vault fetching with Pyth simulation support
- `entities/oracle.ts` - Oracle decoding and Pyth feed collection (EulerRouter, CrossAdapter, PythOracle)
- `composables/useEulerAccount.ts` - Portfolio/account loading with Pyth simulation for borrow positions
- `pages/borrow/[collateral]/[borrow]/index.vue` - Borrow page Pyth refresh logic
- `pages/lend/[vault]/index.vue` - Lend page Pyth refresh logic
- `utils/pyth.ts` - Pyth-specific utilities (Hermes API, batch building, `executeLensWithPythSimulation()`)
