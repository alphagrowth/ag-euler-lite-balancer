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
    class="relative flex items-center gap-6 flex-shrink-0 min-h-36 text-white py-6 px-16 bg-euler-dark-500 rounded-[100px] cursor-pointer"
    @click="open"
  >
    <UiIcon
      name="sort"
      class="!w-16 !h-16"
    />
    <span class="whitespace-nowrap overflow-hidden text-ellipsis">{{ placeholder }}</span>
    <span
      v-if="model"
      class="inline-flex justify-center items-center text-aquamarine-700 text-[14px] font-normal py-2 px-6 ml-auto -mr-10 bg-[var(--c-aquamarine-opaque-300)] rounded-[100px]"
    >{{ model }}</span>
  </div>
</template>
