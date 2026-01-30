# Various UI Fixes and Improvements

## Summary
This PR addresses multiple UI/UX issues across the application, including loading states, label consistency, verification displays, LTV ramping support, and terminology normalization.

## Changes

### Loading State Improvements
- **Fixed table flickering**: Reordered state updates in `useVaults.ts` to set loading flags before clearing data maps, preventing premature rendering
- **Added global loading spinner**: Wrapped `NuxtPage` with `<Suspense>` in `app.vue` to show a loading spinner during async page transitions
- **Consistent spinner styling**: Aligned loading spinner styles across earn, lend, and borrow tables

### Table Sorting Enhancements
- **Earn table**: Added "Liquidity" sorting option
- **Lend table**: Added "Utilization" sorting option
- **Borrow table**: Added "Utilization", "Total Borrowed", and "Max ROE" sorting options
- **Reordered options**: Arranged sorting options in a more logical order for all tables

### Label & Terminology Normalization
- **Removed `vaults.json` dependency**: Labels now come exclusively from `products.json` and `entities.json`
- **Normalized "Utilization"**: Changed from British "Utilisation" to American "Utilization"
- **Consistent entity terminology**:
  - "Capital allocator" for Euler Earn governance
  - "Risk manager" for Euler vault (lend/borrow) governance
- **Escrow vault labeling**: Changed "Ungoverned" to "Escrowed collateral" for clarity

### Verification & Unknown States
- **Risk manager verification**: Added `isVaultGovernorVerified` function that checks if `governorAdmin` matches any declared entity in `products.json`
- **Capital allocator verification**: Added `isEarnVaultOwnerVerified` function for Euler Earn vaults
- **Unknown chips**: Display "Unknown" chip (yellow warning style) for unverified risk managers and capital allocators
- **Vault type chip**: Show "Unknown" instead of "Unverified" for unknown market types

### Oracle Display Fix
- **Fixed oracle section**: Corrected the collateral asset display in `VaultOverviewBlockOracleAdapters` - now uses vault address for oracle decoding but displays the underlying asset symbol

### Borrow Table Fixes
- **Fixed utilization display**: Changed from showing collateral vault utilization to liability vault utilization
- **Fixed label resolution**: Prioritized product name over vault-specific labels for consistent display

### "Can be borrowed/collateral" Counts
- **Fixed count logic**: Now correctly counts borrow pairs from `borrowList` instead of filtering vaults

### LTV Ramping Support
- **Added LTV ramp utilities**: `getCurrentLiquidationLTV`, `isLiquidationLTVRamping`, `getRampTimeRemaining` in `entities/vault.ts`
- **Updated `BorrowVaultPair` interface**: Added `targetTimestamp` and `rampDuration` fields
- **Collateral exposure section**:
  - Shows collaterals where `currentLiquidationLTV > 0` (includes ramping-down collaterals)
  - Displays current interpolated LLTV value
  - Shows info tooltip when LTV is ramping (target LLTV and time remaining)
  - Sorted by borrow LTV descending
  - Only shows collateral-side label (not combined pair label)

### Other Fixes
- **Onboarding page**: Fixed redirect logic to properly handle wallet connection state
- **Earn exposure section**: Added loading spinner and fixed click propagation on tooltips

## Files Changed

### Core Logic
- `composables/useVaults.ts` - Loading state fixes, verification functions, LTV fields in pairs
- `composables/useEulerLabels.ts` - Removed vaults.json dependency
- `entities/vault.ts` - LTV ramp utilities, updated interfaces
- `entities/config.ts` - Removed vaults.json URL
- `entities/euler/labels.ts` - Removed vault label types

### Components
- `app.vue` - Added Suspense wrapper
- `VaultItem.vue` - Updated label display, unknown risk manager chip
- `VaultEarnItem.vue` - Updated label display, unknown capital allocator chip
- `VaultBorrowItem.vue` - Fixed utilization and label display
- `VaultLabelsAndAssets.vue` - Escrow collateral labeling
- `VaultTypeChip.vue` - Unknown chip styling
- `VaultOverviewBlockGeneral.vue` - Fixed counts, unknown risk manager chip
- `VaultOverviewBlockBorrow.vue` - LTV ramping display, sorting, filtering
- `VaultOverviewBlockStats.vue` - Utilization spelling
- `VaultOverviewBlockAddresses.vue` - Risk manager terminology
- `VaultOverviewBlockOracleAdapters.vue` - Fixed asset display
- `VaultOverviewPair.vue` - Fixed collateral prop passing
- `SecuritizeVaultOverview.vue` - Risk manager terminology, unknown chip
- `VaultOverviewEarnBlockGeneral.vue` - Unknown capital allocator chip
- `VaultOverviewEarnBlockExposure.vue` - Loading spinner, click handling
- `ChooseCollateralModal.vue` - Escrow collateral labeling
- `PortfolioBorrowItem.vue` - Escrow collateral labeling
- `PortfolioBorrowCollateralItem.vue` - Escrow collateral labeling

### Pages
- `pages/index.vue` (Lend) - Loading state, sorting options
- `pages/borrow/index.vue` - Loading state, sorting options
- `pages/earn/index.vue` - Loading state, sorting options
- `pages/lend/[vault]/index.vue` - Escrow vault loading fix
- `pages/earn/[vault]/index.vue` - Top-level await
- `pages/onboarding.vue` - Redirect logic fix

