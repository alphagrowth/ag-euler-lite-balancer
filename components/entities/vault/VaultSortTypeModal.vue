<script setup lang="ts">
const emits = defineEmits(['close'])
const { options, selected, onSave } = defineProps<{
  options: string[]
  selected?: string
  title?: string
  onSave: (selected: string) => void
}>()

const selectedIdx = ref(options.findIndex(option => option === selected))

const handleClose = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    :title="title"
    @close="handleClose"
  >
    <div
      v-for="(option, idx) in options"
      :key="`options-${idx}`"
      :class="[$style.row, selectedIdx === idx ? $style._selected : null]"
      @click="onSave(option)"
    >
      <div class="grow-1">
        <div class="text-euler-dark-1000 mb-2">
          {{ option }}
        </div>
      </div>
    </div>
  </BaseModalWrapper>
</template>

<style lang="scss" module>
.row {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  border-radius: 16px;

  &._selected {
    background-color: var(--c-euler-dark-600);
  }
}
</style>
