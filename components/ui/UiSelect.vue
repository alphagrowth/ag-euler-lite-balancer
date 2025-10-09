<script setup lang="ts">
import { useModal } from '~/components/ui/composables/useModal'
import { UiSelectModal } from '#components'

const model = defineModel<string[]>({ required: true })
const props = defineProps<{
  options: { label: string, value: string, icon?: string }[]
  placeholder?: string
  title?: string
  icon?: string
  showSelectedOptions?: boolean
  optionsChips?: boolean
}>()

const modal = useModal()

const displayText = computed(() => {
  if (model.value.length === 0 || !props.showSelectedOptions) {
    return props.placeholder || 'Select...'
  }

  return props.options
    .filter(opt => model.value.includes(opt.value))
    .map(opt => opt.label)
    .slice(0, 2)
    .join(', ')
})

const plusText = computed(() => {
  if (
    (props.showSelectedOptions && model.value.length < 3)
    || (!props.showSelectedOptions && !model.value.length)
  ) {
    return null
  }

  return `+${props.showSelectedOptions ? model.value.length - 2 : model.value.length}`
})

const sortedOptions = computed(() => {
  return [...props.options].sort((a) => {
    if (model.value.includes(a.value)) {
      return -1
    }

    return 0
  })
})

const toggleOption = (value: string) => {
  if (model.value.includes(value)) {
    model.value = model.value.filter(v => v !== value)
  }
  else {
    model.value.push(value)
  }
}

const open = () => {
  modal.open(UiSelectModal, {
    props: {
      selected: model.value,
      options: props.options,
      title: props.title,
      onSave: (selected: string[]) => {
        model.value = selected
      },
    },
  })
}
</script>

<template>
  <div
    :class="['ui-select', { 'ui-select--chips': optionsChips }]"
  >
    <div
      class="ui-select__field"
      @click="open"
    >
      <UiIcon
        v-if="icon"
        :name="icon"
        class="ui-select__icon"
      />
      <span class="ui-select__text">{{ displayText }}</span>
      <span
        v-if="plusText"
        class="ui-select__plus"
      >{{ plusText }}</span>
      <UiIcon
        v-if="model.length < 3 && !icon"
        name="arrow-down"
        class="ui-select__arrow"
      />
    </div>
    <template v-if="optionsChips">
      <div
        v-for="option in sortedOptions"
        :key="option.value"
        :class="['ui-select__chip', { 'ui-select__chip--active': model.includes(option.value) }]"
        @click="toggleOption(option.value)"
      >
        {{ option.label }}
        <UiIcon
          v-if="model.includes(option.value)"
          name="close"
          class="ui-select__chip-icon"
        />
      </div>
    </template>
  </div>
</template>

<style lang="scss">
.ui-select {
  position: relative;
  width: 100%;

  &--chips {
    display: flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    max-width: 100%;
    overflow: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__field {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-grow: 1;
    min-height: 36px;
    color: var(--ui-select-field-color);
    font-size: 14px;
    font-weight: 400;
    padding: 6px 16px;
    background: var(--ui-select-field-background-color);
    border-radius: 100px;
    cursor: pointer;
  }

  &__icon {
    width: 16px;
    height: 16px;
  }

  &__text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__plus {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    color: var(--ui-select-plus-color);
    font-size: 14px;
    font-weight: 400;
    padding: 2px 6px;
    margin-left: auto;
    margin-right: -10px;
    background: var(--ui-select-plus-background-color);
    border-radius: 100px;
  }

  &__arrow {
    width: 16px;
    height: 16px;
    margin-left: auto;
    margin-right: -4px;
  }

  &__chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 400;
    background: var(--ui-select-chip-background-color);
    border-radius: 100px;
    cursor: pointer;

    &--active {
      font-weight: 600;
      background: var(--ui-select-chip-active-background-color);
      color: var(--ui-select-chip-active-color);
    }
  }

  &__chip-icon {
    width: 16px;
    height: 16px;
  }
}
</style>
