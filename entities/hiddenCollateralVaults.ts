// TEMPORARY: Hide collateral vaults pending on-chain LTV removal via multisig.
// Remove this file once setLTV(collateral, 0, 0, 0) is executed on-chain for each address below.
export const HIDDEN_COLLATERAL_VAULTS = new Set([
  '0x175831af06c30f2ea5ea1e3f5eba207735eb9f92', // Pool 4 (wnLOAZND/AZND/wnAUSD) — wrong Merkl pool
])
