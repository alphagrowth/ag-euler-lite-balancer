<script setup lang="ts">
import { type MenuItem, menuItems } from '~/entities/menu'

const route = useRoute()

const getMenuIcon = (item: MenuItem) => {
  if (item.name === 'index') {
    return route.name === 'index' || route.name?.toString().startsWith('lend') ? item.activeIcon : item.icon
  }

  return route.name?.toString().startsWith(item.name) ? item.activeIcon : item.icon
}
</script>

<template>
  <div
    class="fixed bottom-0 left-0 right-0 z-[100] laptop:!hidden bg-euler-dark-300 p-16 justify-center"
  >
    <div
      class="flex w-full h-50 max-w-container"
    >
      <NuxtLink
        v-for="link in menuItems"
        :key="link.name"
        :to="{ name: link.name }"
        class="text-white flex flex-col items-center text-center flex-1 text-decoration-none text-[12px]"
      >
        <UiIcon
          class="!w-20 !h-20 mb-10 text-aquamarine-700"
          :name="getMenuIcon(link)"
        />
        <span>{{ link.label }}</span>
      </NuxtLink>
    </div>
  </div>
</template>
