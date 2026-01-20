<script setup lang="ts">
type SwapRouteBadgeTone = 'best' | 'worse'

type SwapRouteItem = {
  provider: string
  amount: string
  symbol: string
  routeLabel?: string
  badge?: {
    label: string
    tone: SwapRouteBadgeTone
  }
}

withDefaults(defineProps<{
  title?: string
  statusLabel?: string | null
  items: SwapRouteItem[]
  selectedProvider?: string | null
  isLoading?: boolean
  emptyMessage?: string
}>(), {
  title: 'Select swap route',
  statusLabel: null,
  selectedProvider: null,
  isLoading: false,
  emptyMessage: 'Enter amount to fetch quotes',
})

const emit = defineEmits<{
  (e: 'select', provider: string): void
}>()

const onSelect = (provider: string) => {
  emit('select', provider)
}
</script>

<template>
  <div class="bg-euler-dark-400 p-16 rounded-16 flex flex-col gap-12">
    <div class="flex justify-between items-center">
      <p class="text-p2 text-white">
        {{ title }}
      </p>
      <p class="text-p3 text-euler-dark-900">
        {{ statusLabel || '-' }}
      </p>
    </div>
    <div class="flex flex-col gap-8 max-h-[240px] overflow-y-auto pr-4">
      <template v-if="items.length">
        <button
          v-for="item in items"
          :key="item.provider"
          type="button"
          class="w-full text-left rounded-12 border p-12 transition-colors"
          :class="selectedProvider === item.provider
            ? 'border-teal-light-300 bg-euler-dark-500'
            : 'border-euler-dark-500 bg-euler-dark-400 hover:bg-euler-dark-500'"
          @click="onSelect(item.provider)"
        >
          <div class="flex items-start justify-between gap-8">
            <p class="text-p2 text-white">
              {{ item.amount }} {{ item.symbol }}
            </p>
            <p
              v-if="item.badge"
              class="text-p3"
              :class="item.badge.tone === 'best' ? 'text-green-600' : 'text-red-600'"
            >
              {{ item.badge.label }}
            </p>
          </div>
          <div class="flex items-center justify-between gap-8 text-p3 text-euler-dark-900">
            <span class="truncate">{{ item.provider }}</span>
            <span class="truncate">{{ item.routeLabel || '-' }}</span>
          </div>
        </button>
      </template>
      <template v-else-if="isLoading">
        <div class="h-48 rounded-12 bg-euler-dark-500 animate-pulse" />
        <div class="h-48 rounded-12 bg-euler-dark-500 animate-pulse" />
        <div class="h-48 rounded-12 bg-euler-dark-500 animate-pulse" />
      </template>
      <template v-else>
        <p class="text-p3 text-euler-dark-900">
          {{ emptyMessage }}
        </p>
      </template>
    </div>
  </div>
</template>
