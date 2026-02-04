export const BATCH_ITEM_COMPONENTS = [
  { name: 'targetContract', type: 'address' },
  { name: 'onBehalfOfAccount', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
] as const

export const BATCH_ITEM_RESULT_COMPONENTS = [
  { name: 'success', type: 'bool' },
  { name: 'result', type: 'bytes' },
] as const

export const EVC_ABI = [
  {
    inputs: [
      {
        components: BATCH_ITEM_COMPONENTS,
        name: 'items',
        type: 'tuple[]',
      },
    ],
    name: 'batch',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: BATCH_ITEM_COMPONENTS,
        name: 'items',
        type: 'tuple[]',
      },
    ],
    name: 'batchSimulation',
    outputs: [
      {
        components: BATCH_ITEM_RESULT_COMPONENTS,
        name: 'batchItemsResult',
        type: 'tuple[]',
      },
      {
        components: [
          { name: 'account', type: 'address' },
          { name: 'isValid', type: 'bool' },
        ],
        name: 'accountsStatusResult',
        type: 'tuple[]',
      },
      {
        components: [
          { name: 'vault', type: 'address' },
          { name: 'isValid', type: 'bool' },
        ],
        name: 'vaultsStatusResult',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    name: 'isAccountOperatorAuthorized',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export type BatchItem = {
  targetContract: string
  onBehalfOfAccount: string
  value: bigint
  data: string
}

export type BatchItemResult = {
  success: boolean
  result: string
}

export const evcEnableControllerAbi = [
  'function enableController(address,address) external',
] as const

export const evcDisableControllerAbi = [
  'function disableController() external',
] as const

export const evcEnableCollateralAbi = [
  'function enableCollateral(address,address) external',
] as const

export const evcDisableCollateralAbi = [
  'function disableCollateral(address,address) external',
] as const

export const evcGetControllersAbi = [
  'function getControllers(address) external view returns(address[])',
] as const
