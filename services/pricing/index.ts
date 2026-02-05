export {
  // Types
  type PriceResult,
  type PriceSource,
  type BackendConfig,

  // Constants
  ONE_18,

  // Layer 1: Raw Oracle Prices (Unit of Account) - always on-chain
  getAssetOraclePrice,
  getCollateralShareOraclePrice,
  getCollateralOraclePrice,
  getUnitOfAccountUsdRate,

  // Layer 2: USD Price Info (async, supports backend)
  getAssetUsdPrice,
  getCollateralUsdPrice,

  // Layer 3: USD Value Calculation (async, supports backend)
  getAssetUsdValue,
  getCollateralUsdValue,
  formatAssetValue,

  // Liquidation helpers
  calculateLiquidationRatio,
} from './priceProvider'

// Backend client exports
export {
  configureBackend,
  isBackendConfigured,
  clearStaleBackendCache,
  fetchBackendPrice,
  fetchBackendPrices,
  fetchBackendCollateralPrices,
  backendPriceToBigInt,
  type BackendPriceData,
  type BackendPriceResponse,
  type BackendCollateralPriceData,
  type BackendCollateralPriceResponse,
} from './backendClient'
