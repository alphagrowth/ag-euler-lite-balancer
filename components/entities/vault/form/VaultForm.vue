<script setup lang="ts">
defineProps<{ title?: string, loading?: boolean }>()
</script>

<template>
  <form
    :class="$style.VaultForm"
    v-bind="$attrs"
    class="column gap-16"
  >
    <h1
      v-if="title"
      class="p1 pb-4"
    >
      {{ title }}
    </h1>

    <div
      v-if="loading"
      class="justify-center align-center"
      style="flex: 1"
    >
      <UiLoader />
    </div>

    <slot v-else />

    <div
      :class="$style.bottom"
      class="column gap-8"
    >
      <slot name="buttons" />
    </div>
  </form>
</template>

<style module lang="scss">
.VaultForm {
  @include respond-to(mobile) {
    min-height: calc(100dvh - 100px);
  }
}

.bottom {
  @include respond-to(mobile) {
    margin-top: auto;
  }
}
</style>
