<script setup lang="ts">
const { isDark, toggleTheme } = useTheme()

defineEmits(['close'])
</script>

<template>
  <BaseModalWrapper
    title="Settings"
    @close="$emit('close')"
  >
    <div class="mb-20 rounded-16 border border-euler-dark-600 bg-euler-dark-500 p-16">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-p2">
            Theme
          </div>
          <div class="text-p3 text-euler-dark-700">
            Follows system setting by default
          </div>
        </div>
        <UiSwitch
          :model-value="isDark"
          @update:model-value="toggleTheme"
        />
      </div>
    </div>
    <Permit2Settings />
    <SlippageSettings />
  </BaseModalWrapper>
</template>
