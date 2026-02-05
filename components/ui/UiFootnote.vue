<script setup lang="ts">
import { onClickOutside, useWindowSize } from '@vueuse/core'
import { offset, useFloating, type AlignedPlacement } from '@floating-ui/vue'
import { useModal } from '~/components/ui/composables/useModal'
import { UiFootnoteModal } from '#components'

const { title, text, tooltipPlacement = 'top-start', customModal } = defineProps<{
  title: string
  text: string
  tooltipPlacement?: AlignedPlacement
  customModal?: Component
}>()

const reference = ref(null)
const floating = ref(null)
const isVisible = ref(false)

const modal = useModal()
const { width } = useWindowSize()
const { floatingStyles, update } = useFloating(reference, floating, {
  placement: tooltipPlacement,
  middleware: [
    offset({ mainAxis: 15, crossAxis: -15 }),
  ],
})

const onClick = () => {
  if (width.value < 768) {
    modal.open(customModal || UiFootnoteModal, {
      props: {
        modalTitle: title,
        text,
      },
    })
  }
  else {
    isVisible.value = !isVisible.value
    update()
  }
}

onClickOutside(reference, () => {
  isVisible.value = false
})
</script>

<template>
  <div
    ref="reference"
    class="ui-footnote"
    @click="onClick"
  >
    <SvgIcon
      class="ui-footnote__icon"
      name="info-circle"
    />
    <Transition
      name="tooltip"
      @enter="update"
      @after-enter="update"
    >
      <div
        v-show="isVisible"
        ref="floating"
        :style="floatingStyles"
        class="ui-footnote__floating"
        @click.stop
      >
        <div class="ui-footnote__floating-content">
          <div class="ui-footnote__floating-title">
            {{ title }}
          </div>
          <div class="ui-footnote__floating-text">
            {{ text }}
          </div>
        </div>
        <div class="ui-footnote__arrow" />
      </div>
    </Transition>
  </div>
</template>

<style lang="scss">
.ui-footnote {
  position: relative;
  width: 20px;
  height: 20px;
  cursor: pointer;
  transition: opacity 0.3s ease-in-out;

  &__icon {
    width: 20px;
    height: 20px;
    color: var(--ui-footnote-icon-color);
    transition: color 0.2s ease-in-out;
  }

  &__floating {
    position: relative;
    max-width: calc(800px / 2);
    min-width: 200px;
    width: max-content;
    padding: 16px;
    border-radius: 12px;
    background-color: var(--ui-footnote-floating-background-color);
    box-shadow: 0 8px 32px var(--ui-footnote-floating-box-shadow-color);
  }

  &__floating-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  &__floating-title {
    font-weight: 600;
    font-size: 14px;
    line-height: 20px;
    white-space: nowrap;
  }

  &__floating-text {
    font-weight: 400;
    font-size: 14px;
    line-height: 20px;
    word-wrap: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  &__arrow {
    position: absolute;
    bottom: -6px;
    left: 20px;
    width: 12px;
    height: 12px;
    background-color: var(--ui-footnote-arrow-background-color);
    transform: rotate(45deg);
  }
}
</style>
