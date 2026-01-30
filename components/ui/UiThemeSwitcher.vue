<script setup lang="ts">
const theme = useLocalStorage('theme', 'light')

const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <button
    type="button"
    class="theme-switcher"
    :class="{ 'theme-switcher--dark': theme === 'dark' }"
    :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
    :title="theme === 'dark' ? 'Light' : 'Dark'"
    @click="toggleTheme"
  >
    <!-- Sun icon -->
    <svg
      class="theme-switcher__icon theme-switcher__icon--sun"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
    <!-- Moon icon -->
    <svg
      class="theme-switcher__icon theme-switcher__icon--moon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  </button>
</template>

<style lang="scss">
.theme-switcher {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--bg-card);
  border: 1px solid var(--border-default);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;

  &:hover {
    background-color: var(--bg-card-hover);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }

  &__icon {
    width: 18px;
    height: 18px;
    color: var(--text-secondary);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: absolute;

    &--sun {
      opacity: 1;
      transform: rotate(0deg) scale(1);
    }

    &--moon {
      opacity: 0;
      transform: rotate(-90deg) scale(0.5);
    }
  }

  &--dark {
    .theme-switcher__icon--sun {
      opacity: 0;
      transform: rotate(90deg) scale(0.5);
    }

    .theme-switcher__icon--moon {
      opacity: 1;
      transform: rotate(0deg) scale(1);
    }
  }
}
</style>

