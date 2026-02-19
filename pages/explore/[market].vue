<script setup lang="ts">
import { useMarketGroups } from '~/composables/useMarketGroups'
import { getMarketEntities } from '~/utils/discoveryCalculations'

defineOptions({
  name: 'ExploreMarketPage',
})

const route = useRoute()
const marketKey = computed(() => route.params.market as string)

const { marketGroups, isResolvingTVL } = useMarketGroups()
const { isUpdating, isEarnUpdating, isEscrowUpdating } = useVaults()
const { products } = useEulerLabels()

const isLoading = computed(() =>
  isUpdating.value || isEarnUpdating.value || isEscrowUpdating.value
  || isResolvingTVL.value || marketGroups.value.length === 0,
)

const market = computed(() =>
  marketGroups.value.find(g => g.id === marketKey.value),
)

const marketEntities = computed(() =>
  market.value ? getMarketEntities(market.value) : { name: '', logos: [] },
)

const marketDescription = computed(() => {
  if (!market.value || market.value.source !== 'product') return ''
  return products[market.value.id]?.description ?? ''
})
</script>

<template>
  <section class="flex flex-col min-h-[calc(100dvh-178px)]">
    <!-- Back link -->
    <NuxtLink
      to="/explore"
      class="flex items-center gap-4 text-p3 text-content-tertiary hover:text-accent-600 transition-colors mb-16"
    >
      <UiIcon name="arrow-left" class="!w-16 !h-16" />
      Back to Explore
    </NuxtLink>

    <!-- Loading -->
    <UiLoader
      v-if="isLoading"
      class="flex-1 self-center justify-self-center"
    />

    <!-- Market not found -->
    <div
      v-else-if="!market"
      class="flex flex-col flex-1 gap-12 items-center justify-center text-content-tertiary"
    >
      <UiIcon name="search" class="!w-24 !h-24" />
      <div class="text-center max-w-[240px]">
        Market not found. It may not exist on this network.
      </div>
      <NuxtLink
        to="/explore"
        class="text-p3 text-accent-600 underline mt-8"
      >
        Browse all markets
      </NuxtLink>
    </div>

    <!-- Market page -->
    <template v-else>
      <!-- Header -->
      <div class="flex items-center mb-24 animate-fade-in-up">
        <BaseAvatar
          v-if="marketEntities.logos.length > 0"
          class="icon--52 shrink-0 mr-16"
          :src="marketEntities.logos"
          :label="marketEntities.name"
        />
        <div
          v-else
          class="w-[52px] h-[52px] rounded-[14px] mr-16 bg-gradient-to-br from-accent-300/30 to-accent-400/40 flex items-center justify-center text-accent-600 flex-shrink-0 shadow-sm"
        >
          <SvgIcon name="nodes" class="!w-28 !h-28" />
        </div>
        <div>
          <div
            v-if="marketEntities.name"
            class="text-p3 text-content-tertiary mb-4"
          >
            {{ marketEntities.name }}
          </div>
          <h1 class="text-h3 text-content-primary">
            {{ market.name }}
          </h1>
          <p
            v-if="marketDescription"
            class="text-p3 text-content-tertiary mt-4 line-clamp-2"
          >
            {{ marketDescription }}
          </p>
        </div>
      </div>

      <DiscoveryMarketAccordion
        :markets="[market]"
        :initial-expanded="[market.id]"
      />
    </template>
  </section>
</template>
