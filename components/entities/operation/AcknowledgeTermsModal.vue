<script setup lang="ts">
const props = defineProps<{
  onAccept?: () => void
  onReject?: () => void
}>()
const emits = defineEmits(['close'])

const onReject = () => {
  if (props.onReject) {
    props.onReject()
  }
  emits('close')
}
const onAccept = () => {
  if (props.onAccept) {
    props.onAccept()
  }
  emits('close')
}
</script>

<template>
  <BaseModalWrapper
    title="Acknowledge terms"
    @close="onReject"
  >
    <div class="text-white flex flex-col gap-12 mb-16">
      <p class="text-euler-dark-900">
        Please confirm each statement:
      </p>
      <ul class="flex flex-col gap-10">
        <li class="flex gap-8">
          <span class="text-aquamarine-700">•</span>
          <span>
            I am not a resident of, located in, or incorporated in any Restricted Jurisdiction. I will not access
            this site or use our products or services while in any restricted locations, nor use a VPN to mask my
            location.
          </span>
        </li>
        <li class="flex gap-8">
          <span class="text-aquamarine-700">•</span>
          <span>
            I am permitted to access this site and use Euler software under the laws of my jurisdiction.
          </span>
        </li>
        <li class="flex gap-8">
          <span class="text-aquamarine-700">•</span>
          <span>
            I am not a Sanctioned Person (as defined in the ToU) nor acting on behalf of one.
          </span>
        </li>
        <li class="flex gap-8">
          <span class="text-aquamarine-700">•</span>
          <span>
            The App, Protocol, and related software are experimental and may result in complete loss of funds. The
            company and its affiliates do not custody or control user assets or transactions; liquidations are
            performed by the protocol or its users.
          </span>
        </li>
        <li class="flex gap-8">
          <span class="text-aquamarine-700">•</span>
          <span>
            I understand the risks of decentralised finance and engaging with blockchain and other web3 software
            and services, including technical, operational, market, liquidity, and legal risks.
          </span>
        </li>
      </ul>
    </div>
    <div class="flex gap-8">
      <UiButton
        size="large"
        rounded
        variant="secondary"
        @click="onReject"
      >
        Reject
      </UiButton>
      <UiButton
        size="large"
        rounded
        @click="onAccept"
      >
        Accept
      </UiButton>
    </div>
  </BaseModalWrapper>
</template>
