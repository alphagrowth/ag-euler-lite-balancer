<script setup lang="ts">
import { encodeFunctionData, getAddress, toFunctionSelector } from 'viem'
import type { Address, Hex } from 'viem'
import type { Reward } from '~/entities/merkl'
import type { Campaign } from '~/entities/brevis'
import type { VaultAsset } from '~/entities/vault'
import type { TxPlan } from '~/entities/txPlan'
import type { EVCCall } from '~/utils/evc-converter'
import { useVaultRegistry } from '~/composables/useVaultRegistry'

// Map function selectors to human-readable labels for batch items
const SELECTOR_LABELS: Record<string, string> = {
  [toFunctionSelector('function deposit(uint256,address)')]: 'Supply',
  [toFunctionSelector('function borrow(uint256,address)')]: 'Borrow',
  [toFunctionSelector('function repay(uint256,address)')]: 'Repay',
  [toFunctionSelector('function withdraw(uint256,address,address)')]: 'Withdraw',
  [toFunctionSelector('function redeem(uint256,address,address)')]: 'Withdraw',
  [toFunctionSelector('function enableController(address,address)')]: 'Enable controller',
  [toFunctionSelector('function enableCollateral(address,address)')]: 'Enable collateral',
  [toFunctionSelector('function disableController()')]: 'Disable controller',
  [toFunctionSelector('function disableCollateral(address,address)')]: 'Disable collateral',
  [toFunctionSelector('function transferFromMax(address,address)')]: 'Transfer',
  [toFunctionSelector('function signTermsOfUse(string,bytes32)')]: 'Sign terms of use',
  [toFunctionSelector('function multicall(bytes[])')]: 'Swap',
  [toFunctionSelector('function verifyAmountMinAndSkim(address,address,uint256,uint256)')]: 'Verify min received',
  [toFunctionSelector('function verifyDebtMax(address,address,uint256,uint256)')]: 'Verify max debt',
  [toFunctionSelector('function updatePriceFeeds(bytes[])')]: 'Update price feeds',
}

const decodeBatchItemLabel = (data: string): string => {
  const selector = data.slice(0, 10).toLowerCase()
  return SELECTOR_LABELS[selector] || 'Unknown operation'
}

const emits = defineEmits(['close', 'confirm'])

interface REULUnlockInfo {
  unlockableAmount: number
  amountToBeBurned: number
  maturityDate: string
  daysUntilMaturity: number
}

const { type, asset, rewardInfo, campaignInfo, reulUnlockInfo, amount, onConfirm, fee, plan, swapToAsset, swapToAmount, supplyingAssetForBorrow, supplyingAmount } = defineProps<{
  type?: 'supply' | 'withdraw' | 'borrow' | 'repay' | 'swap' | 'reward' | 'brevis-reward' | 'reul-unlock' | 'disableCollateral'
  asset: VaultAsset
  amount: number | string
  fee?: number | string
  plan?: TxPlan
  supplyingAssetForBorrow?: VaultAsset
  supplyingAmount?: number | string
  swapToAsset?: VaultAsset
  swapToAmount?: number | string
  rewardInfo?: Reward
  campaignInfo?: Campaign
  reulUnlockInfo?: REULUnlockInfo
  onConfirm: () => void
  subAccount?: string
  hasBorrows?: boolean
}>()

const { chain, address: walletAddress, chainId: currentChainId } = useWagmi()
const { estimatePlanFees } = useEstimatePlanFees()
const { getVault } = useVaultRegistry()
const { buildSimulationStateOverride } = useEulerOperations()
const { eulerCoreAddresses } = useEulerAddresses()
const { isSimulating: isTenderlySimulating, simulationError: tenderlyError, simulate: tenderlySimulate, clearSimulation: clearTenderly, fetchEnabled: fetchTenderlyEnabled } = useTenderlySimulation()

const isEstimatingFee = ref(false)
const feeEstimate = ref<string | null>(null)
const copied = ref(false)
const tenderlyEnabled = ref(false)

fetchTenderlyEnabled().then((enabled) => { tenderlyEnabled.value = enabled })

const handleTenderlySimulate = async () => {
  if (!plan?.steps || !walletAddress.value || !currentChainId.value) return
  clearTenderly()

  try {
    const owner = walletAddress.value as Address
    const stateOverrides = await buildSimulationStateOverride(plan, owner)

    const mainStep = plan.steps.find(s => s.type === 'evc-batch')
    if (!mainStep) return

    const batchItems = mainStep.args?.[0] as EVCCall[] | undefined
    if (!batchItems?.length) return

    const permit2Address = eulerCoreAddresses.value?.permit2 as string | undefined

    const filteredItems = permit2Address
      ? batchItems.filter(
        call => call.targetContract.toLowerCase() !== permit2Address.toLowerCase(),
      )
      : batchItems

    const data = encodeFunctionData({
      abi: mainStep.abi,
      functionName: mainStep.functionName,
      args: [filteredItems],
    })

    const url = await tenderlySimulate({
      chainId: currentChainId.value,
      from: owner,
      to: mainStep.to,
      data: data as Hex,
      value: mainStep.value?.toString() || '0',
      stateOverrides,
    })

    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
  catch {
    // Error is already captured in tenderlyError ref by the composable
  }
}

const nativeSymbol = computed(() => chain.value?.nativeCurrency?.symbol || 'ETH')

const loadFeeEstimate = async () => {
  if (!plan) {
    feeEstimate.value = null
    return
  }

  try {
    isEstimatingFee.value = true
    const res = await estimatePlanFees(plan)
    feeEstimate.value = res.totalNative
  }
  catch (err) {
    console.warn('[OperationReviewModal] fee estimate failed', err)
    feeEstimate.value = null
  }
  finally {
    isEstimatingFee.value = false
  }
}

watch(() => plan, () => {
  loadFeeEstimate()
}, { immediate: true })

const handleConfirm = () => {
  emits('close')
  onConfirm()
}

const cleanStepLabel = (label: string) => {
  return label
    .replace(/\s*via EVC$/i, '')
    .replace(/^Permit2\s+/i, '')
}

interface StepAssetInfo {
  symbol: string
  address?: string
  amount?: number | string
}

interface DisplayStep {
  index: number
  label: string
  labelSuffix?: string
  isSeparateTx: boolean
  assetInfo?: StepAssetInfo
  toAssetInfo?: StepAssetInfo
  iconOnly?: boolean
}

// Extract the second address param from enableCollateral/enableController calldata
const decodeVaultAddressFromData = (data: string): string | undefined => {
  // ABI layout: 4 bytes selector + 32 bytes (address1) + 32 bytes (address2)
  // The vault address is the second param, at hex chars 10+64=74, last 40 chars of that word
  if (data.length < 138) return undefined
  try {
    return getAddress(`0x${data.slice(98, 138)}`)
  }
  catch {
    return undefined
  }
}

const getVaultAssetInfo = (data: string, targetContract: string): StepAssetInfo | undefined => {
  const vaultAddress = decodeVaultAddressFromData(data)
  const vault = vaultAddress ? getVault(vaultAddress) : undefined
  if (vault?.asset) return { symbol: vault.asset.symbol, address: vault.asset.address }

  try {
    const targetVault = getVault(getAddress(targetContract))
    if (targetVault?.asset) return { symbol: targetVault.asset.symbol, address: targetVault.asset.address }
  }
  catch { /* ignore */ }

  return undefined
}

const getAssetInfoForStep = (label: string, data: string, targetContract: string, usedSupply: { value: boolean }, usedBorrow: { value: boolean }, usedSwapTo: { value: boolean }): StepAssetInfo | undefined => {
  if (label === 'Enable collateral' || label === 'Enable controller' || label === 'Disable collateral' || label === 'Disable controller') {
    return getVaultAssetInfo(data, targetContract)
  }

  if (label === 'Supply' || label === 'Withdraw') {
    // For borrow type with supplyingAssetForBorrow, the supply step uses that asset
    if (type === 'borrow' && !usedSupply.value && label === 'Supply' && supplyingAssetForBorrow && supplyingAmount) {
      usedSupply.value = true
      return { symbol: supplyingAssetForBorrow.symbol, address: supplyingAssetForBorrow.address, amount: supplyingAmount }
    }
    // Otherwise use the main asset
    return { symbol: asset.symbol, address: asset.address, amount }
  }

  if (label === 'Borrow' || label === 'Repay') {
    if (!usedBorrow.value) {
      usedBorrow.value = true
      return { symbol: asset.symbol, address: asset.address, amount }
    }
  }

  if (label === 'Swap') {
    return { symbol: asset.symbol, address: asset.address, amount }
  }

  if (label === 'Verify min received') {
    if (swapToAsset && swapToAmount && !usedSwapTo.value) {
      usedSwapTo.value = true
      return { symbol: swapToAsset.symbol, address: swapToAsset.address, amount: swapToAmount }
    }
    return { symbol: asset.symbol, address: asset.address, amount }
  }

  if (label === 'Verify max debt') {
    return { symbol: asset.symbol, address: asset.address, amount }
  }

  if (label === 'Update price feeds') {
    return { symbol: asset.symbol, address: asset.address }
  }

  return undefined
}

const displaySteps = computed((): DisplayStep[] => {
  if (!plan?.steps) return []

  const steps: DisplayStep[] = []
  let index = 0
  const usedSupply = { value: false }
  const usedBorrow = { value: false }
  const usedSwapTo = { value: false }

  for (const step of plan.steps) {
    if (step.type === 'evc-batch') {
      // Expand batch into individual operations
      const batchItems = step.args?.[0] as EVCCall[] | undefined
      if (batchItems?.length) {
        for (const item of batchItems) {
          index++
          const label = decodeBatchItemLabel(item.data)
          const stepAssetInfo = getAssetInfoForStep(label, item.data, item.targetContract, usedSupply, usedBorrow, usedSwapTo)
          const secondAsset = supplyingAssetForBorrow || swapToAsset
          let toAssetInfo: StepAssetInfo | undefined
          if (label === 'Swap' && swapToAsset && swapToAmount) {
            toAssetInfo = { symbol: swapToAsset.symbol, address: swapToAsset.address, amount: swapToAmount }
          }
          else if (label === 'Update price feeds' && stepAssetInfo && secondAsset && secondAsset.symbol !== asset.symbol) {
            toAssetInfo = { symbol: secondAsset.symbol, address: secondAsset.address }
          }
          steps.push({
            index,
            label,
            isSeparateTx: false,
            assetInfo: stepAssetInfo,
            toAssetInfo,
            iconOnly: label === 'Update price feeds',
          })
        }
      }
      else {
        index++
        steps.push({
          index,
          label: cleanStepLabel(step.label || step.functionName),
          isSeparateTx: false,
        })
      }
    }
    else {
      index++
      const isApproval = step.type === 'approve' || step.type === 'permit2-approve'
      const approvalAsset = isApproval
        ? (type === 'borrow' && supplyingAssetForBorrow ? supplyingAssetForBorrow : asset)
        : undefined

      const labelSuffix = step.type === 'approve'
        ? 'for vault'
        : step.type === 'permit2-approve'
          ? 'for permit2'
          : undefined

      steps.push({
        index,
        label: isApproval ? 'Approve' : cleanStepLabel(step.label || step.functionName),
        labelSuffix,
        isSeparateTx: isApproval,
        assetInfo: approvalAsset ? { symbol: approvalAsset.symbol, address: approvalAsset.address } : undefined,
      })
    }
  }

  return steps
})

const copyCalldata = () => {
  if (!plan?.steps) return

  try {
    const calldataEntries = plan.steps.map(step => ({
      to: step.to,
      data: encodeFunctionData({
        abi: step.abi,
        functionName: step.functionName,
        args: step.args,
      }),
      value: step.value?.toString() || '0',
    }))

    navigator.clipboard.writeText(JSON.stringify(calldataEntries, null, 2))
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch (err) {
    console.warn('[OperationReviewModal] calldata copy failed', err)
  }
}

const btnLabel = computed(() => {
  switch (type) {
    case 'supply':
      return 'Supply'
    case 'withdraw':
      return 'Withdraw'
    case 'borrow':
      return 'Borrow'
    case 'repay':
      return 'Repay'
    case 'swap':
      return 'Swap'
    case 'reul-unlock':
      return 'Unlock'
    case 'reward':
    case 'brevis-reward':
      return 'Claim'
    case 'disableCollateral':
      return 'Disable collateral'
    default:
      return 'Submit'
  }
})
const reulUnlockDisclaimerText = computed(() => {
  if (type !== 'reul-unlock' || !reulUnlockInfo) return

  return `This action will unlock ${formatNumber(reulUnlockInfo.unlockableAmount, 6)} EUL, and ${formatNumber(reulUnlockInfo.amountToBeBurned, 6)} EUL will be permanently burned. To fully redeem your EUL rewards, you must wait for the 6-month vesting period to complete (${reulUnlockInfo.daysUntilMaturity} days remaining, maturity date: ${reulUnlockInfo.maturityDate}).`
})
const anyNonEulerReward = computed(() => {
  return !!(rewardInfo?.breakdowns.find(breakdown => !breakdown.reason.startsWith('EULER')))
})
const eulerOnlyRewardsAmount = computed(() => {
  return rewardInfo?.breakdowns
    .filter(breakdown => breakdown.reason.startsWith('EULER'))
    .reduce((prev, curr) => {
      return prev + nanoToValue(BigInt(curr.amount) - BigInt(curr.claimed), rewardInfo.token.decimals)
    }, 0)
})
const totalClaimAmount = computed(() => {
  return Number(amount) < 0.01 ? '< 0.01' : formatNumber(amount)
})
const eulerClaimAmount = computed(() => {
  const eulerAmount = eulerOnlyRewardsAmount.value || 0
  return eulerAmount < 0.01 && eulerAmount > 0 ? '< 0.01' : formatNumber(eulerAmount)
})
const otherClaimAmount = computed(() => {
  const eulerAmount = eulerOnlyRewardsAmount.value || 0
  const otherAmount = Math.max(0, Number(amount) - eulerAmount)
  return otherAmount < 0.01 && otherAmount > 0 ? '< 0.01' : formatNumber(otherAmount)
})
const disclaimerText = computed(() => {
  if (type !== 'reward') return

  return `You're claiming ${totalClaimAmount.value} tokens, ${eulerClaimAmount.value} of them from Euler, ${otherClaimAmount.value} of them earned elsewhere`
})

const hasPermit2Approval = computed(() => {
  return plan?.steps?.some(step => step.type === 'permit2-approve') ?? false
})

const usesPermit2 = computed(() => {
  return plan?.steps?.some(step => step.label?.includes('Permit2')) ?? false
})

const permit2DisclaimerText = 'You are granting the permit2 contract unlimited access to your tokens. This is a safe, one-time setup — permit2 (by Uniswap) is a widely trusted and audited contract that replaces repeated approval transactions with gasless signatures. Each future transaction still requires your explicit signature, limited in both amount and duration.'

const feeDisplay = computed(() => {
  if (isEstimatingFee.value) {
    return '...'
  }

  const value = feeEstimate.value ?? fee
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  return `${formatNumber(value, 8, 0)} ${nativeSymbol.value}`
})
</script>

<template>
  <BaseModalWrapper
    title="Transaction review"
    @close="$emit('close')"
  >
    <div class="flex flex-col gap-24">
      <!-- Transaction Steps -->
      <div
        v-if="displaySteps.length"
        class="flex flex-col gap-8"
      >
        <p class="text-p3 text-euler-dark-900">
          Transaction steps
        </p>
        <div class="bg-euler-dark-600 rounded-12 p-12 flex flex-col gap-8">
          <div
            v-for="step in displaySteps"
            :key="step.index"
            class="flex justify-between items-center"
          >
            <div class="flex gap-6 items-center flex-wrap">
              <p class="text-p3">
                {{ step.index }}. {{ step.label }}
              </p>
              <template v-if="step.assetInfo">
                <BaseAvatar
                  class="icon--16"
                  :src="getAssetLogoUrl(step.assetInfo.address || '', step.assetInfo.symbol)"
                  :label="step.assetInfo.symbol"
                />
                <p
                  v-if="!step.iconOnly"
                  class="text-p3"
                >
                  <template v-if="step.assetInfo.amount !== undefined">{{ formatNumber(step.assetInfo.amount, 8, 0) }}&nbsp;</template>{{ step.assetInfo.symbol }}
                </p>
              </template>
              <p
                v-if="step.labelSuffix"
                class="text-p3"
              >
                {{ step.labelSuffix }}
              </p>
              <template v-if="step.toAssetInfo">
                <p
                  v-if="!step.iconOnly"
                  class="text-p3 text-euler-dark-900"
                >
                  &rarr;
                </p>
                <BaseAvatar
                  class="icon--16"
                  :src="getAssetLogoUrl(step.toAssetInfo.address || '', step.toAssetInfo.symbol)"
                  :label="step.toAssetInfo.symbol"
                />
                <p
                  v-if="!step.iconOnly"
                  class="text-p3"
                >
                  <template v-if="step.toAssetInfo.amount !== undefined">{{ formatNumber(step.toAssetInfo.amount, 8, 0) }}&nbsp;</template>{{ step.toAssetInfo.symbol }}
                </p>
              </template>
            </div>
            <span
              v-if="step.isSeparateTx"
              class="text-p4 text-euler-dark-900"
            >
              Separate tx
            </span>
          </div>
        </div>
      </div>

      <!-- Fee -->
      <div class="flex-wrap gap-8 bg-euler-dark-600 p-16 rounded-12 flex justify-between">
        <div class="flex gap-8 items-center">
          <UiIcon
            name="gas"
            class="!w-20 !h-20"
          />
          Transaction fee
        </div>
        <div class="flex gap-8 items-center">
          <span class="text-p2">&asymp; {{ feeDisplay }}</span>
        </div>
      </div>

      <!-- Copy calldata & Tenderly simulate -->
      <div
        v-if="plan?.steps?.length"
        class="flex items-center justify-center gap-16"
      >
        <button
          type="button"
          class="flex items-center gap-6 text-p3 text-euler-dark-900 hover:text-euler-dark-1000 transition-colors"
          @click="copyCalldata"
        >
          <SvgIcon
            name="copy"
            class="!w-16 !h-16"
          />
          {{ copied ? 'Copied!' : 'Copy calldata' }}
        </button>
        <button
          v-if="tenderlyEnabled"
          type="button"
          class="flex items-center gap-6 text-p3 text-euler-dark-900 hover:text-euler-dark-1000 transition-colors"
          :disabled="isTenderlySimulating"
          @click="handleTenderlySimulate"
        >
          <SvgIcon
            :name="isTenderlySimulating ? 'loading' : 'arrow-top-right'"
            class="!w-16 !h-16"
            :class="{ 'animate-spin': isTenderlySimulating }"
          />
          Simulate on Tenderly
        </button>
      </div>
      <p
        v-if="usesPermit2"
        class="text-p4 text-euler-dark-900 text-center"
      >
        Final calldata may contain an additional permit() call. It is only known after the permit2 message is signed.
      </p>

      <!-- Tenderly error -->
      <UiToast
        v-if="tenderlyError"
        title="Simulation failed"
        variant="warning"
        :description="tenderlyError"
        size="compact"
      />

      <!-- Disclaimers -->
      <UiToast
        v-if="type === 'reward' && anyNonEulerReward"
        title="Disclaimer"
        variant="warning"
        :description="disclaimerText"
        size="compact"
      />
      <UiToast
        v-if="type === 'reul-unlock'"
        title="Important"
        variant="warning"
        :description="reulUnlockDisclaimerText"
        size="compact"
      />
      <UiToast
        v-if="type === 'disableCollateral'"
        title="Disclaimer"
        variant="warning"
        description="Disabling collateral will move this deposit to savings"
        size="compact"
      />
      <UiToast
        v-if="hasPermit2Approval"
        title="Infinite approval"
        variant="info"
        :description="permit2DisclaimerText"
        size="compact"
      />

      <!-- Confirm button -->
      <UiButton
        variant="primary"
        size="xlarge"
        rounded
        @click="handleConfirm"
      >
        {{ btnLabel }}
      </UiButton>
    </div>
  </BaseModalWrapper>
</template>
