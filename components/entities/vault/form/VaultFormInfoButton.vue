<script setup lang="ts">
import type { BorrowVaultPair, EarnVault, Vault } from '~/entities/vault'
import { VaultOverviewModal } from '#components'
import { useModal } from '~/components/ui/composables/useModal'
import type { AccountBorrowPosition } from '~/entities/account'

const { vault, pair, earnVault } = defineProps<{ vault?: Vault, pair?: BorrowVaultPair | AccountBorrowPosition, earnVault?: EarnVault, disabled?: boolean }>()
const modal = useModal()

const onClick = () => {
  modal.open(VaultOverviewModal, {
    props: {
      pair: pair,
      vault: vault,
      earnVault: earnVault,
    },
  })
}
</script>

<template>
  <UiButton
    size="large"
    variant="primary-stroke"
    :disabled="disabled"
    @click="onClick"
  >
    {{ pair ? 'Pair information' : 'Vault information' }}
  </UiButton>
</template>

<style scoped lang="scss">

</style>
