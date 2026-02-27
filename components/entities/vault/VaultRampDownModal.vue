<script setup lang="ts">
import { DateTime } from 'luxon'
import { formatNumber } from '~/utils/string-utils'
import { nanoToValue } from '~/utils/crypto-utils'
import type { LTVRampConfig } from '~/entities/vault/ltv'

const emits = defineEmits(['close'])
const { liquidationLTV, targetTimestamp } = defineProps<LTVRampConfig>()

const rampTimeRemaining = computed(() => DateTime.fromSeconds(Number(targetTimestamp)))

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="LTV ramping"
    @close="handleClose"
  >
    <div class="mb-24">
      <div class="flex justify-between items-center pb-16 border-b border-euler-dark-600">
        <div>
          <p class="mb-4">
            Target LLTV
          </p>
          <p class="text-euler-dark-900">
            Final LLTV after ramp
          </p>
        </div>
        <div class="text-h5">
          {{ `${formatNumber(nanoToValue(liquidationLTV, 2), 2)}%` }}
        </div>
      </div>
      <div class="flex justify-between items-center mt-16">
        <div>
          <p class="mb-4">
            Ramp time ends
          </p>
          <p class="text-euler-dark-900">
            Time remaining until ramp ends
          </p>
        </div>
        <div class="text-h5">
          {{ rampTimeRemaining.toRelative({ base: DateTime.now(), style: 'short' }) }}
        </div>
      </div>
    </div>
  </BaseModalWrapper>
</template>
