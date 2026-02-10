import type { Opportunity } from '~/entities/merkl'
import type { Campaign } from '~/entities/brevis'

type RewardInfo = {
  opportunity: Opportunity | undefined
  campaign: Campaign | undefined
}

export const useRewardsApy = () => {
  const { settings } = useUserSettings()
  const { getOpportunityOfLendVault, getOpportunityOfBorrowVault, lendOpportunities, borrowOpportunities } = useMerkl()
  const { getCampaignOfLendVault, getCampaignOfBorrowVault, lendCampaigns, borrowCampaigns } = useBrevis()

  const isEnabled = computed(() => settings.value.enableRewardsApy)

  // Reactive version counter — bumps when any underlying data or settings change.
  // Consumers should read `version.value` in the sync phase of watchEffect(async)
  // to ensure they re-run when reward data updates.
  const _versionCounter = ref(0)
  watch(
    [isEnabled, lendOpportunities, borrowOpportunities, lendCampaigns, borrowCampaigns],
    () => { _versionCounter.value++ },
  )
  const version = computed(() => _versionCounter.value)

  const getSupplyRewardApy = (vaultAddress: string): number => {
    if (!isEnabled.value) return 0
    const opportunity = getOpportunityOfLendVault(vaultAddress)
    const campaign = getCampaignOfLendVault(vaultAddress)
    return (opportunity?.apr || 0) + (campaign?.reward_info.apr || 0) * 100
  }

  const getBorrowRewardApy = (borrowAssetAddress: string, borrowVaultAddress: string): number => {
    if (!isEnabled.value) return 0
    const opportunity = getOpportunityOfBorrowVault(borrowAssetAddress)
    const campaign = getCampaignOfBorrowVault(borrowVaultAddress)
    return (opportunity?.apr || 0) + (campaign?.reward_info.apr || 0) * 100
  }

  const getSupplyRewardInfo = (vaultAddress: string): RewardInfo => {
    if (!isEnabled.value) return { opportunity: undefined, campaign: undefined }
    return {
      opportunity: getOpportunityOfLendVault(vaultAddress),
      campaign: getCampaignOfLendVault(vaultAddress),
    }
  }

  const getBorrowRewardInfo = (borrowAssetAddress: string, borrowVaultAddress: string): RewardInfo => {
    if (!isEnabled.value) return { opportunity: undefined, campaign: undefined }
    return {
      opportunity: getOpportunityOfBorrowVault(borrowAssetAddress),
      campaign: getCampaignOfBorrowVault(borrowVaultAddress),
    }
  }

  return {
    isEnabled,
    version,
    getSupplyRewardApy,
    getBorrowRewardApy,
    getSupplyRewardInfo,
    getBorrowRewardInfo,
  }
}
