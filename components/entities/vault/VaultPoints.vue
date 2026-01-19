<script setup lang="ts">
import { offset, useFloating } from '@floating-ui/vue'
import type { EarnVault, Vault } from '~/entities/vault'

const { vault } = defineProps<{ vault: Vault | EarnVault }>()

const points = useEulerPointsOfVault(vault.address)

const activeTooltip = ref<{ name: string, logo: string } | null>(null)
const reference = ref<HTMLElement | null>(null)
const floating = ref<HTMLElement | null>(null)
const hideTimeout = ref<NodeJS.Timeout | null>(null)

const { floatingStyles, update } = useFloating(reference, floating, {
  placement: 'top-end',
  middleware: [
    offset({ mainAxis: 8, crossAxis: 55 }),
  ],
})

const escapeHtml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const isValidUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url)
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:'
  }
  catch {
    return false
  }
}

const convertMarkdownLinks = (text: string): string => {
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let result = ''
  let match

  while ((match = markdownLinkRegex.exec(text)) !== null) {
    result += escapeHtml(text.substring(lastIndex, match.index))

    const linkText = match[1]
    const url = match[2]

    if (isValidUrl(url)) {
      const safeUrl = escapeHtml(url)
      const safeText = escapeHtml(linkText)
      result += `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-aquamarine-700 hover:underline" onclick="event.stopPropagation()">${safeText}</a>`
    }
    else {
      result += escapeHtml(linkText)
    }

    lastIndex = markdownLinkRegex.lastIndex
  }

  result += escapeHtml(text.substring(lastIndex))

  return result
}

const formattedTooltipName = computed(() => {
  if (!activeTooltip.value?.name) return ''
  return convertMarkdownLinks(activeTooltip.value.name)
})

const showTooltip = (pointName: string, pointLogo: string, event: MouseEvent | TouchEvent) => {
  event.stopPropagation()

  if (hideTimeout.value) {
    clearTimeout(hideTimeout.value)
    hideTimeout.value = null
  }

  reference.value = event.target as HTMLElement
  activeTooltip.value = { name: pointName, logo: pointLogo }
  nextTick(() => update())
}

const hideTooltip = (event?: MouseEvent | TouchEvent) => {
  event?.stopPropagation()

  hideTimeout.value = setTimeout(() => {
    activeTooltip.value = null
  }, 100)
}

const keepTooltipVisible = () => {
  if (hideTimeout.value) {
    clearTimeout(hideTimeout.value)
    hideTimeout.value = null
  }
}

const hideTooltipImmediate = () => {
  hideTimeout.value = setTimeout(() => {
    activeTooltip.value = null
  }, 100)
}
</script>

<template>
  <div class="text-p1 flex items-center gap-0 hover:gap-8 transition-[gap] duration-300 ease-in-out">
    <img
      v-for="(point, index) in points"
      :key="point.name"
      class="w-16 h-16 rounded-full cursor-pointer select-none"
      :class="{ '-ml-6': index > 0 }"
      :src="`/entities/${point.logo}`"
      alt="Points entity logo"
      draggable="false"
      @mouseenter="showTooltip(point.name, point.logo, $event)"
      @mouseleave="hideTooltip($event)"
      @touchstart.prevent="showTooltip(point.name, point.logo, $event)"
      @touchend.prevent="hideTooltip($event)"
      @contextmenu.prevent
    >
    <Transition name="tooltip">
      <div
        v-show="activeTooltip"
        ref="floating"
        :style="floatingStyles"
        class="pointer-events-auto flex-wrap px-12 py-10 rounded-8 bg-euler-dark-500 border border-euler-dark-700 text-white text-sm z-50 flex items-center gap-4 max-w-[300px] break-words cursor-auto"
        :class="{ 'opacity-0 invisible': !activeTooltip?.name }"
        @mouseenter="keepTooltipVisible"
        @mouseleave="hideTooltipImmediate"
      >
        <span>Deposit earns</span>
        <img
          v-if="activeTooltip"
          :src="`/entities/${activeTooltip.logo}`"
          alt="Point logo"
          class="w-16 h-16 rounded-full"
        >
        <!-- eslint-disable-next-line vue/no-v-html -->
        <span v-html="formattedTooltipName" />
      </div>
    </Transition>
  </div>
</template>
