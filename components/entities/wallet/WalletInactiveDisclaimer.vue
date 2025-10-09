<template>
  <div
    class="flex gap-12 br-8 p-20"
    :class="$style.WalletInactiveDisclaimer"
  >
    <SvgIcon
      :class="$style.icon"
      class="icon--20"
      name="info-circle"
    />
    <div>
      <p class="h6 mb-2">
        Your TON wallet is not yet activated
      </p>
      <p>
        To activate it, simply send any outgoing transaction. This enables the wallet and allows you to start using the app features.
      </p>
    </div>
  </div>
</template>

<style lang="scss" module>
.WalletInactiveDisclaimer {
  color: var(--c-orange-1000);
  background-color: var(--c-yellow-opaque-300);
  border: 1px solid var(--c-yellow-opaque-400);
}

.icon {
  flex-shrink: 0;
}
</style>
