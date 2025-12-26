<script setup lang="ts">
const emits = defineEmits(['close'])

const terms = [
  {
    icon: 'map-pin-off',
    text: `I am not a resident of, located in, or incorporated in any Restricted Jurisdiction.
    I will not access this site or use our products or services while in any restricted locations,
    nor use a VPN to mask my location.`,
  },
  {
    icon: 'globe',
    text: `I am permitted to access this site and use Euler
    software under the laws of my jurisdiction.`,
  },
  {
    icon: 'search-user',
    text: `I am permitted to access this site and use Euler
    software under the laws of my jurisdiction.`,
  },
  {
    icon: 'shield',
    text: `The App, Protocol, and related software are experimental and may result in
    complete loss of funds. The company and its affiliates do not custody or control user assets
    or transactions; liquidations are performed by the protocol or its users.`,
  },
  {
    icon: 'chart',
    text: `I understand the risks of decentralised finance and engaging with blockchain and other
    web3 software and services, including technical, operational,
    market, liquidity, and legal risks.`,
  },
]

const onAcceptClick = () => {
  useLocalStorage('is-terms-and-conditions-accepted', false).value = true
  emits('close')
}

const onRejectClick = () => {
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    full
    title="Acknowledge terms"
    @close="$emit('close')"
  >
    <div
      class="flex flex-col gap-24 full flex-grow [scrollbar-width:none]"
    >
      <div class="text-p3 text-euler-dark-900">
        By accessing or using Euler's products and services, I agree to the
        <a class="text-aquamarine-700 underline cursor-pointer hover:text-aquamarine-600">Terms of Use</a>, <a class="text-aquamarine-700 underline cursor-pointer hover:text-aquamarine-600">Privacy Policy</a>, and
        <a class="text-aquamarine-700 underline cursor-pointer hover:text-aquamarine-600">Risk Disclosures</a>. I further represent and warrant:
      </div>

      <div
        class="bg-euler-dark-100 rounded-12 overflow-auto flex-1 [scrollbar-width:none]"
      >
        <div
          v-for="(term, index) in terms"
          :key="index"
          class="flex gap-16 p-16"
          :class="[index !== terms.length - 1 ? 'border-b border-euler-dark-400' : '']"
        >
          <div
            class="bg-euler-dark-500 rounded-8 flex align-center justify-center w-48 h-48 flex-shrink-0"
          >
            <UiIcon
              :name="term.icon"
              class="text-euler-dark-900"
            />
          </div>
          <div class="text-p3 text-white">
            {{ term.text }}
          </div>
        </div>
      </div>

      <div class="flex gap-8">
        <UiButton
          variant="primary-stroke"
          size="xlarge"
          rounded
          @click="onRejectClick"
        >
          Reject
        </UiButton>
        <UiButton
          variant="primary"
          size="xlarge"
          rounded
          @click="onAcceptClick"
        >
          Accept
        </UiButton>
      </div>
    </div>
  </BaseModalWrapper>
</template>
