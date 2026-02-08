<script setup lang="ts">
import { defaultPageRoute } from '~/entities/menu'

const route = useRoute()
await navigateTo(
  { name: defaultPageRoute, query: route.query, hash: route.hash },
  { replace: true },
)
</script>

<template>
  <div />
</template>
