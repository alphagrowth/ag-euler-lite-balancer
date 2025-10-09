<script setup lang="ts">
import AssetInput from '~/components/entities/asset/AssetInput.vue'
import type { VaultAsset } from '~/entities/vault'
import { useModal } from '~/components/ui/composables/useModal'
import { LegalTermsAcknowledgeModal } from '#components'

const radioModel = ref('radio-test-1')
const tabsModel = ref(0)
const checkboxModel = ref(false)
const asset: VaultAsset = {
  name: 'Mock TON',
  decimals: 18n,
  symbol: 'mTON',
  address: '0xc981cd0aC047D1Bc55aF4B6A9cF7fA82465363D0',
}

const modal = useModal()
const openLegalModal = () => {
  modal.open(LegalTermsAcknowledgeModal)
}
</script>

<template>
  <section>
    <div style="max-width: 380px;">
      <div class="p-16">
        <AssetInput
          :asset="asset"
          class="mb-16"
          style="max-width: 380px"
        />

        <UiRange
          class="mb-16"
          label="Label"
        />
      </div>

      <div class="flex align-center gap-8">
        <UiCheckbox
          v-model="checkboxModel"
          name="test"
          size="large"
          self-value="radio-test-1"
        />
        <UiCheckbox
          v-model="checkboxModel"
          name="test"
          self-value="radio-test-1"
        />
        <UiCheckbox
          v-model="checkboxModel"
          name="test"
          self-value="radio-test-1"
          disabled
        />
      </div>

      <div class="mb-16">
        <UiTabs
          v-model="tabsModel"
          :list="[{
            label: 'Tab 1',
            value: 0,
          }, {
            label: 'Tab 2',
            value: 1,
            badge: '1',
          }, {
            label: 'Tab 3',
            value: 2,
          }]"
          label="Rounded"
          rounded
          class="mb-16"
        />
        <UiTabs
          v-model="tabsModel"
          :list="[{
            label: 'Tab 1',
            value: 0,
          }, {
            label: 'Tab 2',
            value: 1,
          }, {
            label: 'Tab 3',
            value: 2,
          }]"
          label="Pills"
          pills
        />
      </div>

      <div class="mb-16">
        <div class="mb-16">
          <UiButton
            variant="primary"
            size="large"
            icon="plus"
            rounded
            @click="openLegalModal"
          >
            Show Legal Modal
          </UiButton>
          <UiButton
            variant="primary-stroke"
            size="large"
            rounded
          >
            Primary Stroke Large
          </UiButton>
          <UiButton
            class="mb-8"
            variant="primary-stroke"
            size="large"
            icon="plus"
            loading
            rounded
          >
            Loading
          </UiButton>
        </div>
        <div class="mb-16">
          <UiButton
            variant="secondary"
            size="medium"
            icon="plus"
            rounded
          >
            Secondary Medium
          </UiButton>
          <UiButton
            variant="secondary-ghost"
            size="medium"
            rounded
          >
            Secondary Ghost Medium
          </UiButton>
        </div>
        <div class="mb-16">
          <UiButton
            variant="red"
            size="small"
            icon="plus"
            rounded
          >
            Red Small
          </UiButton>
          <UiButton
            variant="red-destructive"
            size="small"
            rounded
          >
            Red Destructive Small
          </UiButton>
        </div>
        <div class="mb-16">
          <UiButton
            class="mb-8"
            variant="primary"
            size="small"
            disabled
            rounded
          >
            Primary Medium Disabled
          </UiButton>
          <UiButton
            class="mb-8"
            variant="primary-stroke"
            size="small"
            disabled
            rounded
          >
            Primary Stroke Disabled
          </UiButton>
        </div>
        <div class="mb-16">
          <UiButton
            class="mb-8"
            variant="primary"
            size="large"
            icon="plus"
            icon-only
          />
          <UiButton
            class="mb-8"
            variant="primary-stroke"
            size="large"
            icon="plus"
            icon-only
          />
        </div>
      </div>

      <div class="h1">
        Headline 1
      </div>
      <div class="h2">
        Headline 2
      </div>
      <div class="h3">
        Headline 3
      </div>
      <div class="h4">
        Headline 4
      </div>
      <div class="h5">
        Headline 5
      </div>
      <div class="p1">
        Paragraph 1
      </div>
      <div class="p2">
        Paragraph 2
      </div>
      <div class="p3">
        Paragraph 3
      </div>
      <div class="text-white">
        White
      </div>
      <div class="text-black">
        Black
      </div>
      <div class="text-red-600">
        Red-600
      </div>
      <div class="text-red-800">
        Red-800
      </div>
      <div class="text-red-1000">
        Red-1000
      </div>
      <div class="text-green-600">
        Green-600
      </div>
      <div class="text-green-1000">
        Green-1000
      </div>
      <div class="text-yellow-600">
        Yellow-600
      </div>
      <div class="text-yellow-1000">
        Yellow-1000
      </div>
      <div class="text-yellow-warning-700">
        Yellow-warning-700
      </div>
      <div class="text-slice-of-heaven-300">
        Slice-of-heaven-300
      </div>
      <SvgIcon
        :class="$style.icon"
        name="close"
      />
      <SvgIcon
        :class="$style.icon"
        name="copy"
      />
      <SvgIcon
        :class="$style.icon"
        name="edit"
      />
      <SvgIcon
        :class="$style.icon"
        name="filter"
      />
      <SvgIcon
        :class="$style.icon"
        name="gas"
      />
      <SvgIcon
        :class="$style.icon"
        name="health"
      />
      <SvgIcon
        :class="$style.icon"
        name="loading"
      />
      <SvgIcon
        :class="$style.icon"
        name="percent"
      />
      <SvgIcon
        :class="$style.icon"
        name="plus"
      />
      <SvgIcon
        :class="$style.icon"
        name="question-circle"
      />
      <SvgIcon
        :class="$style.icon"
        name="search"
      />
      <SvgIcon
        :class="$style.icon"
        name="shield"
      />
      <SvgIcon
        :class="$style.icon"
        name="sparks"
      />
      <SvgIcon
        :class="$style.icon"
        name="trash"
      />
      <SvgIcon
        :class="$style.icon"
        name="unlink"
      />
      <SvgIcon
        :class="$style.icon"
        name="wallet"
      />
      <SvgIcon
        :class="$style.icon"
        name="warning-circle"
      />
      <SvgIcon
        :class="$style.icon"
        name="arrow-down"
      />
      <SvgIcon
        :class="$style.icon"
        name="arrow-top-right"
      />
      <SvgIcon
        :class="$style.icon"
        name="lend-outline"
      />
      <SvgIcon
        :class="$style.icon"
        name="lend-filled"
      />
      <SvgIcon
        :class="$style.icon"
        name="borrow-outline"
      />
      <SvgIcon
        :class="$style.icon"
        name="borrow-filled"
      />
      <SvgIcon
        :class="$style.icon"
        name="portfolio-outline"
      />
      <SvgIcon
        :class="$style.icon"
        name="portfolio-filled"
      />
      <UiIcon
        :class="$style.icon"
        name="map-pin-off"
      />
      <UiIcon
        :class="$style.icon"
        name="globe"
      />
      <UiIcon
        :class="$style.icon"
        name="search-user"
      />
      <UiIcon
        :class="$style.icon"
        name="chart"
      />
    </div>
    <div class="flex align-center mb-8">
      <UiRadio
        v-model="radioModel"
        name="test"
        label="Test"
        self-value="radio-test-1"
      />
      <UiRadio
        v-model="radioModel"
        name="test"
        label="Test"
        self-value="radio-test-2"
      />
      <UiRadio
        v-model="radioModel"
        name="test"
        label="Test"
        self-value="radio-test-3"
        disabled
      />
    </div>

    <div class="flex align-center gap-8">
      Health score
      <UiFootnote
        title="Your health score"
        text="Health score measures how safe your position is. A score above 1 means you're safe; below 1 means you're at risk of liquidation."
      />
    </div>
  </section>
</template>

<style lang="scss" module>
.icon {
  width: 24px;
  height: 24px;
}
</style>
