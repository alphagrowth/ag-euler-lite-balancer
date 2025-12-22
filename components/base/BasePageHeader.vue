<script setup lang="ts">
defineProps({
  title: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  arrowDown: Boolean,
})
</script>

<template>
  <div :class="$style.PageHeader">
    <div :class="[$style.icon, arrowDown ? $style._down : null]">
      <SvgIcon
        name="arrow-big"
      />
    </div>
    <div>
      <div class="h3 mb-4">
        {{ title }}
      </div>
      <p class="text-euler-dark-900">
        {{ description }}
      </p>
    </div>
  </div>
</template>

<style lang="scss" module>
.PageHeader {
  display: flex;
  align-items: center;
}

.icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  margin-right: 16px;
  background: linear-gradient(180deg, hsl(var(--aquamarine-700) / 0.08) 0%, hsl(var(--aquamarine-700) / 0.2) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--c-aquamarine-700);

  svg {
    transform: rotate(180deg);
  }

  &._down {
    svg {
      transform: rotate(0);
    }
  }
}
</style>
