<script setup lang="ts">
import { autoLink } from '~/utils/autoLink'
import { stopLinkPropagation } from '~/utils/stopLinkPropagation'

const props = defineProps<{ notice: string }>()

const isDeprecatedNotice = computed(() => props.notice.toLowerCase().includes('deprecated'))
</script>

<template>
  <div
    v-if="notice"
    class="portfolio-notice"
    :class="{ 'portfolio-notice--deprecated': isDeprecatedNotice }"
  >
    <SvgIcon
      name="info-circle"
      class="portfolio-notice__icon"
    />
    <!-- eslint-disable vue/no-v-html -- trusted label content -->
    <span
      class="portfolio-notice__text auto-link"
      @click="stopLinkPropagation"
      v-html="autoLink(notice)"
    />
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<style lang="scss">
.portfolio-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 12px;
  border: 1px solid var(--accent-300);
  background: var(--accent-100);
  padding: 12px;
  color: var(--accent-700);

  &--deprecated {
    border-color: var(--ui-toast-warning-border-color);
    background: var(--warning-100);
    color: var(--warning-500);
  }

  &__icon {
    width: 20px !important;
    height: 20px !important;
    flex-shrink: 0;
    color: currentColor;
  }

  &__text {
    color: currentColor;
    font-size: 14px;
    line-height: 20px;
  }
}
</style>
