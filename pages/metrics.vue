<script setup lang="ts">
import { getVaultPrice } from '~/entities/vault'

defineOptions({
  name: 'MetricsPage',
})

const { isLoading, list } = useVaults()

const totalBorrowed = computed(() => {
  if (isLoading.value) return null

  return list.value.reduce((prev, vault) => {
    return prev + getVaultPrice(vault.borrow, vault)
  }, 0)
})

const totalSupplied = computed(() => {
  if (isLoading.value) return null

  return list.value.reduce((prev, vault) => {
    return prev + getVaultPrice(vault.supply, vault)
  }, 0)
})
</script>

<template>
  <section
    :class="$style.MetricsPage"
    class="column gap-16"
  >
    <h1 class="h2 p-32 center justify-center align-center gap-8">
      <img
        class="icon--32"
        src="/logo.png"
        alt="Euler"
      >Euler TMA Metrics
    </h1>
    <div :class="$style.grid">
      <div
        class="column gap-16 p-24 br-16 justify-center align-center"
        :class="$style.metricsItem"
      >
        <h2 class="h4 text-euler-dark-900">
          Total supplied
        </h2>
        <p class="h1 text-euler-dark-1000">
          <BaseLoadableContent
            :loading="isLoading"
            :style="{ width: isLoading ? '120px' : 'auto', height: isLoading ? '40px' : 'auto' }"
          >
            <span>${{ compactNumber(totalSupplied || 0) }}</span>
          </BaseLoadableContent>
        </p>
      </div>
      <div
        class="column gap-16 p-24 br-16 justify-center align-center"
        :class="$style.metricsItem"
      >
        <h2 class="h4 text-euler-dark-900">
          Total borrowed
        </h2>
        <p class="h1 text-euler-dark-1000">
          <BaseLoadableContent
            :loading="isLoading"
            :style="{ width: isLoading ? '120px' : 'auto', height: isLoading ? '40px' : 'auto' }"
          >
            <span>${{ compactNumber(totalBorrowed || 0) }}</span>
          </BaseLoadableContent>
        </p>
      </div>
    </div>
  </section>
</template>

<style lang="scss" module>
.MetricsPage {
  min-height: calc(100dvh - 178px);
}

.grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.metricsItem {
  flex: 1;
  border: 1px solid var(--c-euler-dark-600);
}
</style>
