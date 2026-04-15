// TEMPORARY: Hide collateral vaults during redeployment.
// Old vaults: wrong BPT addresses, hidden as safety net.
// New vaults: correct BPTs, hidden pending testing. Remove after Step 2F.
export const HIDDEN_COLLATERAL_VAULTS = new Set([
  '0x578c60e6df60336be41b316fde74aa3e2a4e0ea5', // Old Kintsu (sMON/wnWMON) — wrong BPT
  '0x6660195421557bc6803e875466f99a764ae49ed7', // Old Fastlane (shMON/wnWMON) — wrong BPT
  '0x175831af06c30f2ea5ea1e3f5eba207735eb9f92', // Old AZND (wnLOAZND/AZND/wnAUSD) — wrong BPT
  '0x7ad9f09b431a4c5f4cba809d449fde842192f9ec', // New Kintsu (wnSMON/wnWMON) — pending testing
  '0x7a81a1613d50fff334027aad76f2416368f6050f', // New Fastlane (wnSHMON/wnWMON) — pending testing
  '0x2067936155c7db57b1cdcf776b04b9678c245626', // New AZND (wnLOAZND/AZND/wnAUSD) — pending testing
])
