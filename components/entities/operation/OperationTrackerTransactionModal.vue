<script setup lang="ts">
import { StageName } from '@tonappchain/sdk/dist/structs/Struct'
import type { TransactionLinker } from '@tonappchain/sdk'
import { Cell } from '@ton/core'
import { useOperationTracker } from '#imports'

const emits = defineEmits(['close'])
const { transactionLinker } = defineProps<{ transactionLinker: TransactionLinker }>()

const { operationId, status, error, destroy } = useOperationTracker(transactionLinker)
const { NETWORK } = useEulerConfig()

const state: Ref<'pending' | 'success' | 'error'> = ref('pending')
const hash = ref('')
const boc = (transactionLinker.sendTransactionResult as { result: { boc: string } })?.result?.boc
if (boc) {
  hash.value = Cell.fromBase64(boc).hash().toString('hex')
}

const statusLabels: Record<string, string> = {
  start: 'Retrieving operation id',
  [StageName.COLLECTED_IN_TAC]: 'Including in TAC consensus',
  [StageName.INCLUDED_IN_TAC_CONSENSUS]: 'Executing in TAC',
  [StageName.EXECUTED_IN_TAC]: 'Collecting in TON',
  [StageName.COLLECTED_IN_TON]: 'Including in TON consensus',
  [StageName.INCLUDED_IN_TON_CONSENSUS]: 'Executing in TAC',
  [StageName.EXECUTED_IN_TON]: 'Finished',
} as const

const statusLabel = computed(() => operationId.value ? statusLabels[status.value || 'start'] : statusLabels.start)
const label = computed(() => {
  switch (state.value) {
    case 'error':
      return 'Transaction took more time than usual'
    case 'pending':
      return 'Transaction pending'
    case 'success':
      return 'Transaction complete'
  }

  return 'Transaction has unknown status'
})

const handleClose = () => {
  destroy()
  emits('close')
}
watch(error, () => {
  destroy()
  state.value = 'error'
})

watch(status, (val) => {
  if (val === StageName.EXECUTED_IN_TON) {
    state.value = 'success'
  }
})
</script>

<template>
  <BaseModalWrapper
    :close="false"
    @close="handleClose()"
  >
    <div
      :class="[$style.OperationTrackerTransactionModal, [$style[`_${state}`]]]"
      class="column align-center"
    >
      <div
        :class="$style.icon"
        class="mb-16 align-center justify-center"
      >
        <UiLoader v-if="state === 'pending'" />
        <UiIcon
          v-else-if="state === 'success'"
          name="check"
        />
        <UiIcon
          v-else-if="state === 'error'"
          name="close"
        />
      </div>
      <div class="h4 mb-12 center">
        {{ label }}
      </div>
      <div
        v-if="statusLabel && state === 'pending' "
        class="h5 weight-400 mb-12 center"
      >
        {{ statusLabel }}...
      </div>
      <a
        v-if="hash"
        :href="`https://${NETWORK === 'testnet' ? 'testnet.' : ''}tonscan.org/tx/${hash}`"
        target="_blank"
        class="flex align-center gap-4 center text-white"
        style="text-decoration: none"
      >
        View on tonscan
        <svg
          width="16"
          height="17"
          viewBox="0 0 16 17"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M11.3333 5.16675L4.66663 11.8334M11.3333 5.16675H5.33329M11.3333 5.16675V11.1667"
            stroke="#DDFBF4"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

      </a>
    </div>

    <UiButton
      class="mt-24"
      variant="primary"
      size="xlarge"
      rounded
      @click="handleClose()"
    >
      {{ state === 'success' ? 'Done' : 'Close' }}
    </UiButton>
  </BaseModalWrapper>
</template>

<style module lang="scss">
.OperationTrackerTransactionModal {
  &._success {
    .icon {
      border-color: var(--c-green-opaque-1000);
      background-color: var(--c-green-opaque-300);
    }
  }

  &._error {
    .icon {
      border-color: var(--c-red-opaque-1000);
      background-color: var(--c-red-opaque-300);
    }
  }
}
.icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 1px solid var(--c-euler-dark-700);
  background-color: var(--c-euler-dark-600);
}
</style>
