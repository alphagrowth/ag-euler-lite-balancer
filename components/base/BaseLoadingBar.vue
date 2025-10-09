<script setup lang="ts">

</script>

<template>
  <div :class="$style.BaseLoadingBar" />
</template>

<style module lang="scss">
.BaseLoadingBar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(200, 200, 200, 0.1);
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;

  &:after {
    content: "";
    position: absolute;
    top: 0;
    left: -50%;
    width: 40%;
    height: 3px;
    background: var(--c-euler-dark-700);
    border-top-left-radius: 8px;
    animation: 1.5s linear 0s infinite normal none running animation;
  }
}

@keyframes animation {
  0% {
    left: -50%;
  }

  100% {
    left: 100%;
  }
}
</style>
