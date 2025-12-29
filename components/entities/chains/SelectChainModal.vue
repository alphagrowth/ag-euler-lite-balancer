<script setup lang="ts">
import { useChains } from '@wagmi/vue'

const emits = defineEmits(['close'])
const chains = useChains()
const { changeChain } = useWagmi()

const handleClose = () => {
  emits('close')
}
const onClick = (chainId: number) => {
  changeChain(chainId)
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Select chain"
    @close="handleClose"
  >
    <div class="mb-24">
      <div
        v-for="chain in chains"
        :key="chain.id"
        class="flex items-center py-12 font-semibold leading-20 text-[16px] cursor-pointer"
        @click="onClick(chain.id)"
      >
        <BaseAvatar
          class="mr-8 w-32 h-32"
          :src="`/chains/${chain.id}.webp`"
        />
        {{ chain.name }}
      </div>
    </div>
  </BaseModalWrapper>
</template>
