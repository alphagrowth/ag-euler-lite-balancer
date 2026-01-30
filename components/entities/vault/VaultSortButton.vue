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
    class="relative flex items-center gap-6 flex-shrink-0 min-h-36 text-content-secondary py-6 px-16 bg-surface border border-line-default rounded-[100px] cursor-pointer hover:border-line-emphasis hover:bg-surface-secondary transition-all"
    @click="open"
  >
    <UiIcon
      name="sort"
      class="!w-16 !h-16 text-content-tertiary"
    />
    <span class="whitespace-nowrap overflow-hidden text-ellipsis">{{ placeholder }}</span>
    <span
      v-if="model"
      class="inline-flex justify-center items-center text-accent-700 text-[14px] font-medium py-2 px-8 ml-auto -mr-10 bg-accent-300/30 rounded-[100px]"
    >{{ model }}</span>
  </div>
</template>
