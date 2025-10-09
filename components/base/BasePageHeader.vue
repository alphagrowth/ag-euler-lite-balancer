<script setup lang="ts">
defineProps({
  title: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  arrowDown: Boolean,
})
</script>

<template>
  <div :class="$style.PageHeader">
    <div :class="[$style.icon, arrowDown ? $style._down : null]" />
    <div>
      <div class="h3 mb-4">
        {{ title }}
      </div>
      <p class="text-euler-dark-900">
        {{ description }}
      </p>
    </div>
  </div>
</template>

<style lang="scss" module>
.PageHeader {
  display: flex;
  align-items: center;
}

.icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background-image: url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTIiIGhlaWdodD0iNTIiIHZpZXdCb3g9IjAgMCA1MiA1MiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3QgeD0iNTIiIHk9IjUyIiB3aWR0aD0iNTEuOTk5OSIgaGVpZ2h0PSI1MiIgcng9IjEyIiB0cmFuc2Zvcm09InJvdGF0ZSgxODAgNTIgNTIpIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfNTQwXzQwOTEpIiBmaWxsLW9wYWNpdHk9IjAuMiIvPgo8cGF0aCBkPSJNMjYgMzVWMTdNMjYgMTdMMTcgMjUuODA1MU0yNiAxN0wzNSAyNS44MDUxIiBzdHJva2U9IiMyQUU1QjkiIHN0cm9rZS13aWR0aD0iMS40NCIgc3Ryb2tlLW1pdGVybGltaXQ9IjEwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfNTQwXzQwOTEiIHgxPSI3OCIgeTE9IjUyIiB4Mj0iNzgiIHkyPSIxMDQiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzJBRTVCOSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyQUU1QjkiIHN0b3Atb3BhY2l0eT0iMC40Ii8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPC9zdmc+Cg==");
  margin-right: 16px;

  &._down {
    background-image: url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTIiIGhlaWdodD0iNTIiIHZpZXdCb3g9IjAgMCA1MiA1MiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3QgeD0iNTIiIHk9IjUxLjk5OTkiIHdpZHRoPSI1MS45OTk5IiBoZWlnaHQ9IjUyIiByeD0iMTIiIHRyYW5zZm9ybT0icm90YXRlKDE4MCA1MiA1MS45OTk5KSIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzQwOV85NjEyKSIgZmlsbC1vcGFjaXR5PSIwLjIiLz4KPHBhdGggZD0iTTI2IDE3VjM1TTI2IDM1TDM1IDI2LjE5NDlNMjYgMzVMMTcgMjYuMTk0OSIgc3Ryb2tlPSIjMkFFNUI5IiBzdHJva2Utd2lkdGg9IjEuNDQiIHN0cm9rZS1taXRlcmxpbWl0PSIxMCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzQwOV85NjEyIiB4MT0iNzgiIHkxPSI1MS45OTk5IiB4Mj0iNzgiIHkyPSIxMDQiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzJBRTVCOSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyQUU1QjkiIHN0b3Atb3BhY2l0eT0iMC40Ii8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPC9zdmc+Cg==");
  }
}
</style>
