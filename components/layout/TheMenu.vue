<script setup lang="ts">
interface Link {
  name: string
  label: string
  icon: string
  activeIcon: string
}

const route = useRoute()

const links: Link[] = [
  {
    name: 'earn',
    label: 'Earn',
    icon: 'lend-outline',
    activeIcon: 'lend-filled',
  },
  {
    name: 'index',
    label: 'Lend',
    icon: 'lend-outline',
    activeIcon: 'lend-filled',
  },
  {
    name: 'borrow',
    label: 'Borrow',
    icon: 'borrow-outline',
    activeIcon: 'borrow-filled',
  },
  {
    name: 'portfolio',
    label: 'Portfolio',
    icon: 'portfolio-outline',
    activeIcon: 'portfolio-filled',
  },
]

const getMenuIcon = (link: Link) => {
  if (link.name === 'index') {
    return route.name === 'index' || route.name?.toString().startsWith('lend') ? link.activeIcon : link.icon
  }

  return route.name?.toString().startsWith(link.name) ? link.activeIcon : link.icon
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
        v-for="link in links"
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
  //box-shadow: 0px -4px 6px 4px var(--c-euler-dark-300);
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
  }
}
</style>
