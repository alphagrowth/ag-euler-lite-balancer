<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps({
  error: {
    type: Object as () => NuxtError<Record<string, any>>,
    default: () => ({}),
  },
})

const router = useRouter()

const errorText = computed(() => {
  return props.error?.message || 'Something went wrong'
})
</script>

<template>
  <NuxtLayout>
    <div :class="$style.errorPage">
      <div class="container column between">
        <div
          :class="$style.content"
          class="column justify-center align-center"
        >
          <div class="p2 center px-16">
            Error:
            {{ errorText }}
          </div>
        </div>
        <UiButton
          variant="primary-stroke"
          size="large"
          rounded
          @click="router.replace('/')"
        >
          Go to Main Page
        </UiButton>
      </div>
    </div>
  </NuxtLayout>
</template>

<style lang='scss' module>
.errorPage {
  display: flex;
  justify-content: center;
  min-height: 100dvh;
  padding: 16px 0;
}

.content {
  height: 100%;
  flex: 1;
}
</style>
