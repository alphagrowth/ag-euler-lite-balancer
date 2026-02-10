<script setup lang="ts">
import { getDefaultPageRoute } from '~/entities/menu'

const { enableEarnPage, enableLendPage } = useDeployConfig()
const defaultPageRoute = getDefaultPageRoute(enableEarnPage, enableLendPage)

const route = useRoute()
await navigateTo(
  { path: `/${defaultPageRoute}`, query: route.query, hash: route.hash },
  { replace: true },
)
</script>

<template>
  <div />
</template>
