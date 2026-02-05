# Pricing System Architecture

This document describes the pricing system in euler-lite, including how prices are fetched, converted to USD, and how Pyth oracles are handled.

## Overview

The pricing system is built as a 3-layer architecture that separates concerns between raw oracle data, USD conversion, and value calculation.

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

- **`getAssetOraclePrice(vault)`** - Returns the vault's asset price in its unit of account from `liabilityPriceInfo`
- **`getCollateralOraclePrice(liabilityVault, collateralVault)`** - Returns collateral asset price in the liability vault's unit of account, converting from share price to asset price
- **`getUnitOfAccountUsdRate(vault)`** - Returns the UoA → USD conversion rate. Returns `1e18` if UoA is USD, otherwise uses `unitOfAccountPriceInfo`

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
getAssetUsdPrice(vault):
  1. oraclePrice = vault.liabilityPriceInfo.amountOutMid  // e.g., 1.0003e18 BOLD in USD
  2. uoaRate = vault.unitOfAccountPriceInfo.amountOutMid  // e.g., 1e18 if UoA is USD
     OR 1e18 if vault.unitOfAccount === USD_ADDRESS
  3. return (oraclePrice × uoaRate) / 1e18
```

## Collateral Price Calculation (Borrow Context)

**Key principle: Collateral prices are ALWAYS from the liability vault's perspective.**

When vault A (liability) accepts vault B (collateral), the price of B is determined by vault A's oracle router, NOT vault B's own oracle. This ensures consistent pricing within a borrow position.

```typescript
getCollateralUsdPrice(liabilityVault, collateralVault):
  1. sharePrice = liabilityVault.collateralPrices.find(collateralVault.address)
  2. assetPrice = sharePrice × (totalShares / totalAssets)  // Convert share→asset
  3. uoaRate = liabilityVault.unitOfAccountPriceInfo       // Use LIABILITY's UoA
  4. return (assetPrice × uoaRate) / 1e18
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
           Yes  │  No → Return vault as-is
                ↓
    Check for price failure
    (queryFailure or missing amountOutMid)
                ↓
           Yes  │  No → Return vault as-is
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
