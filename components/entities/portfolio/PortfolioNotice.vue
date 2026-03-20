<script setup lang="ts">
import { autoLink } from '~/utils/autoLink'

defineProps<{ notice: string }>()
</script>

<template>
  <div
    v-if="notice"
    class="flex items-start gap-8 bg-accent-100 border border-accent-300 rounded-12 p-12"
  >
    <SvgIcon
      name="info-circle"
      class="!w-16 !h-16 text-accent-600 shrink-0 mt-2"
    />
    <span
      class="text-accent-700 text-p4 auto-link"
      v-html="autoLink(notice)"
    />
  </div>
</template>
