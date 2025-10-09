<script setup lang="ts">
import type { REULLock } from '~/entities/merkl'

defineProps<{
  items: REULLock[]
}>()
</script>

<template>
  <div
    :class="$style.RewardUnlockList"
    class="column gap-8"
  >
    <RewardUnlockItem
      v-for="(item, idx) in items"
      :key="`unlock-${idx}`"
      :item="item"
    />
  </div>
</template>

<style lang="scss" module>
.RewardUnlockList {
  ///
}
</style>
