<script setup lang="ts">
import { useChains } from '@wagmi/vue'

const emits = defineEmits(['close'])
const { eulerChainsConfig } = useEulerAddresses();
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
        :class="$style.chain"
        @click="onClick(chain.id)"
      >
        <BaseAvatar :class="$style.img" class="mr-8" :src="`/chains/${chain.id}.webp`" />
        {{ chain.name }}
      </div>
    </div>
  </BaseModalWrapper>
</template>

<style lang="scss" module>
.chain {
  display: flex;
  align-items: center;
  padding: 12px 0;
  font-weight: 600;
  line-height: 20px;
  font-size: 16px;
  cursor: pointer;
}

.img {
  width: 32px;
  height: 32px;
}
</style>
