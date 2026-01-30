<script setup lang="ts">
const model = defineModel<string>()
const props = withDefaults(
  defineProps<{
    placeholder?: string
    label?: string
    helpText?: string
    type?: string
    inputMode?: string
    disabled?: boolean
    error?: boolean
    fullWidth?: boolean
    name?: string
    id?: string
    icon?: string
  }>(),
  {
    type: 'text',
    fullWidth: true,
  },
)

const inputRef = ref()
const uniqueId = computed(() => props.id || props.name || `input-${Math.random().toString(36).substr(2, 9)}`)

const classes = computed(() => {
  return {
    'is-disabled': props.disabled,
    'is-error': props.error,
    'is-full-width': props.fullWidth,
  }
})
</script>

<template>
  <div :class="['ui-input', classes]">
    <div
      v-if="icon"
      class="ui-input__icon-wrap"
      @click="inputRef.focus()"
    >
      <SvgIcon
        :name="icon"
        class="ui-input__icon"
      />
    </div>
    <input
      :id="uniqueId"
      ref="inputRef"
      v-model="model"
      :type="type"
      :inputmode="inputMode"
      :disabled="disabled"
      :name="name"
      :placeholder="placeholder"
      :aria-invalid="error"
      :aria-disabled="disabled"
      :class="['ui-input__field', icon && 'icon']"
    >
  </div>
</template>

<style lang="scss">
.ui-input {
  $block: &;

  display: flex;
  width: 100%;
  background-color: var(--ui-input-background-color);
  border: 1px solid var(--ui-input-border-color);
  border-radius: 8px;

  &:not(.is-full-width) {
    width: fit-content;
  }

  &__field {
    width: 100%;
    min-height: 44px;
    padding: 12px 16px;
    font-size: 16px;
    line-height: 20px;
    font-weight: 400;
    color: var(--ui-input-color);
    outline: none;
    transition: all var(--trs-fast);

    &.icon {
      padding: 12px 16px 12px 0px;
    }

    &::placeholder {
      color: var(--ui-input-placeholder-color);
    }

    &:focus {
      border-color: var(--ui-input-focus-border-color);
    }

    &:-webkit-autofill,
    &:-webkit-autofill:hover,
    &:-webkit-autofill:focus {
      -webkit-text-fill-color: var(--ui-input-color);
      -webkit-box-shadow: 0 0 0px 1000px var(--ui-input-background-color) inset;
      transition: background-color 5000s ease-in-out 0s;
    }
  }

  &.is-error {
    #{$block}__field {
      border-color: var(--ui-input-error-border-color);
    }

    #{$block}__help {
      color: var(--ui-input-error-color);
    }
  }

  &.is-disabled {
    #{$block}__label {
      color: var(--ui-input-disabled-color);
    }

    #{$block}__field {
      background-color: transparent;
      border-color: var(--ui-input-disabled-border-color);
      color: var(--ui-input-disabled-color);
      cursor: not-allowed;
    }
  }

  &__icon-wrap {
    width: 50px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  &__icon {
    width: 20px;
    height: 20px;
    color: var(--ui-input-placeholder-color);
  }
}
</style>
