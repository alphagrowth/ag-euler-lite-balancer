export const EVC_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'targetContract', type: 'address' },
          { name: 'onBehalfOfAccount', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
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
      { name: 'account', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    name: 'isAccountOperatorAuthorized',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

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
