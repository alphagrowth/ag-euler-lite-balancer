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
    :class="$style.TheMenu"
    class="bg-euler-dark-300 p-16 justify-center"
  >
    <div
      :class="$style.wrap"
      class="flex"
    >
      <NuxtLink
        v-for="link in menuItems"
        :key="link.name"
        :to="{ name: link.name }"
        :class="$style.item"
        class="text-white column align-center center"
      >
        <UiIcon
          class="icon--20"
          :name="getMenuIcon(link)"
        />
        <span>{{ link.label }}</span>
      </NuxtLink>
    </div>
  </div>
</template>

<style module lang="scss">
.TheMenu {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: none;

  @include respond-to(mobile) {
    display: block;
  }
}

.wrap {
  width: 100%;
  height: 50px;
  max-width: var(--container-w);
}

.item {
  flex: 1;
  font-size: 12px;
  text-decoration: none;

  svg {
    margin-bottom: 10px;
    color: var(--c-aquamarine-700);
  }
}
</style>
