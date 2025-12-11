<script setup lang="ts">
import { useModal } from '~/components/ui/composables/useModal'
import { VaultSortTypeModal } from '#components'

const model = defineModel<string>({ required: true })
const props = defineProps<{
  options: string[]
  placeholder?: string
  title?: string
}>()

const modal = useModal()

const open = () => {
  modal.open(VaultSortTypeModal, {
    props: {
      selected: model.value,
      options: props.options,
      title: props.title,
      onSave: (selected: string) => {
        model.value = selected
        modal.close()
      },
    },
  })
}
</script>

<template>
  <div
    :class="$style.VaultSortButton"
    @click="open"
  >
    <UiIcon
      name="sort"
      :class="$style.icon"
    />
    <span :class="$style.text">{{ placeholder }}</span>
    <span
      v-if="model"
      :class="$style.plus"
    >{{ model }}</span>
  </div>
</template>

<style lang="scss" module>
.VaultSortButton {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-height: 36px;
  color: var(--c-white);
  padding: 6px 16px;
  background: var(--c-euler-dark-500);
  border-radius: 100px;
  cursor: pointer;
}

.icon {
  width: 16px;
  height: 16px;
}

.text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plus {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  color: var(--c-aquamarine-700);
  font-size: 14px;
  font-weight: 400;
  padding: 2px 6px;
  margin-left: auto;
  margin-right: -10px;
  background: var(--c-aquamarine-opaque-300);
  border-radius: 100px;
}
</style>
