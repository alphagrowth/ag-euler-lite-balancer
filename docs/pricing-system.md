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

The system uses EVC `batchSimulation` to simulate Pyth price updates alongside vault data fetching:

1. **Detection**: `collectPythFeedIds()` extracts ALL Pyth feed IDs from `vault.oracleDetailedInfo`
2. **Simulation**: `fetchVaultWithPythSimulation()` bundles Pyth updates with vault lens call
3. **Refresh**: Page-level watchers detect price failures and trigger re-fetch with simulation

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

```
User navigates to /lend/0xPythVault or /borrow/collateral/0xPythVault
                              ↓
                    Initial vault load
                    (standard getVaultInfoFull)
                              ↓
              ┌───────────────┴───────────────┐
              │ liabilityPriceInfo.queryFailure │
              │ = true (Pyth price stale)       │
              └───────────────┬───────────────┘
                              ↓
                 Page detects price failure
              (hasBorrowPriceFailure() or hasPriceFailure())
                              ↓
                    Calls updateVault()
                              ↓
                    fetchVault() runs
                              ↓
              collectPythFeedIds() finds Pyth feeds
              in vault.oracleDetailedInfo
                              ↓
           fetchVaultWithPythSimulation() called:
           1. Fetch fresh prices from Hermes API
           2. Build Pyth updatePriceFeeds() batch items
           3. Build getVaultInfoFull() batch item
           4. Execute EVC batchSimulation
           5. Decode fresh vault data with updated prices
                              ↓
              Vault now has valid liabilityPriceInfo
              (queryFailure: false, amountOutMid: fresh price)
                              ↓
              priceProvider functions work normally
```

### Key Implementation Details

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

// 3. Only re-query if failure detected
if (hasPythPriceFailure && evc && PYTH_HERMES_URL) {
  vault = await fetchVaultWithPythSimulation(...) || vault
}
```

**Page-level refresh (borrow page example):**
```typescript
const hasBorrowPriceFailure = (vault: Vault | undefined): boolean => {
  if (!vault) return false
  return (
    vault.liabilityPriceInfo?.queryFailure ||
    !vault.liabilityPriceInfo?.amountOutMid ||
    vault.liabilityPriceInfo.amountOutMid === 0n
  )
}

watch(pair, async (val) => {
  if (hasBorrowPriceFailure(val.borrow) && !refreshedVaultAddresses.has(borrowAddr)) {
    refreshedVaultAddresses.add(borrowAddr)
    const refreshedBorrow = await updateVault(val.borrow.address)
    pair.value = { ...val, borrow: refreshedBorrow }
  }
  // Similar logic for collateral vault...
})
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
- `pages/borrow/[collateral]/[borrow]/index.vue` - Borrow page Pyth refresh logic
- `pages/lend/[vault]/index.vue` - Lend page Pyth refresh logic
- `utils/pyth.ts` - Pyth-specific utilities (Hermes API, batch building)
