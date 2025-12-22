<script setup lang="ts">
const {
  title,
  full = false,
  close = true,
  warning = false,
} = defineProps<{
  title?: string
  full?: boolean
  close?: boolean
  warning?: boolean
}>()
defineEmits(['close'])
</script>

<template>
  <div
    :class="[$style.BaseModal, { [$style._full]: full }]"
    class="bg-euler-dark-500"
  >
    <div
      v-if="title || close"
      class="between mb-12 align-center"
      :class="$style.top"
    >
      <div
        v-if="close"
        style="width: 36px"
      />
      <p
        v-if="title"
        class="center p2 align-center gap-8"
      >
        <SvgIcon
          v-if="warning"
          name="warning"
          :class="$style.warning"
        />
        {{ title }}
      </p>
      <UiButton
        v-if="close"
        variant="primary-stroke"
        icon="close"
        name="cross"
        icon-only
        @click="$emit('close')"
      />
    </div>

    <div :class="$style.content">
      <slot />
    </div>

    <slot name="bottom" />
  </div>
</template>

<style module lang="scss">
.BaseModal {
  display: flex;
  flex-direction: column;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 16px;
  min-width: min(375px, 100vw);
  max-width: 600px;
  overflow: auto;
  scrollbar-width: none;
  max-height: calc(85dvh);
  border-radius: 16px;

  &::-webkit-scrollbar {
    display: none;
  }

  @include respond-to(mobile) {
    top: auto;
    left: 0;
    bottom: 0;
    width: 100%;
    min-width: 100%;
    max-height: calc(95dvh);
    transform: translate(0, 0);
    border-radius: 16px 16px 0 0;
  }

  &._full {
    min-height: 85dvh;

    .content {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
    }

    @include respond-to(mobile) {
      min-height: 95dvh;
    }
  }
}

.top {
  height: 36px;
}

.warning {
  width: 20px;
  height: 20px;
  color: var(--c-yellow-600);
}

.close {
  cursor: pointer;
}
</style>
