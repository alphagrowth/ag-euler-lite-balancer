<template>
  <div :class="$style.container">
    <div :class="$style.header">
      <h1 :class="$style.title">
        Toast Notifications Demo
      </h1>
      <p :class="$style.description">
        Test all toast variants and features based on the Figma designs
      </p>
    </div>

    <div :class="$style.section">
      <h2 :class="$style.sectionTitle">
        Basic Toasts
      </h2>
      <div :class="$style.buttonGrid">
        <UiButton
          variant="primary"
          @click="showInfoToast"
        >
          Info Toast
        </UiButton>
        <UiButton
          variant="primary"
          @click="showSuccessToast"
        >
          Success Toast
        </UiButton>
        <UiButton
          variant="primary"
          @click="showWarningToast"
        >
          Warning Toast
        </UiButton>
        <UiButton
          variant="primary"
          @click="showErrorToast"
        >
          Error Toast
        </UiButton>
        <UiButton
          variant="primary"
          @click="showNeutralToast"
        >
          Neutral Toast
        </UiButton>
      </div>
    </div>

    <div :class="$style.section">
      <h2 :class="$style.sectionTitle">
        Compact Size Toasts
      </h2>
      <div :class="$style.buttonGrid">
        <UiButton
          variant="secondary"
          @click="showCompactInfoToast"
        >
          Compact Info
        </UiButton>
        <UiButton
          variant="secondary"
          @click="showCompactSuccessToast"
        >
          Compact Success
        </UiButton>
        <UiButton
          variant="secondary"
          @click="showCompactWarningToast"
        >
          Compact Warning
        </UiButton>
        <UiButton
          variant="secondary"
          @click="showCompactErrorToast"
        >
          Compact Error
        </UiButton>
      </div>
    </div>

    <div :class="$style.section">
      <h2 :class="$style.sectionTitle">
        Toasts with Actions
      </h2>
      <div :class="$style.buttonGrid">
        <UiButton
          variant="tertiary"
          @click="showActionToast"
        >
          Toast with Action
        </UiButton>
        <UiButton
          variant="tertiary"
          @click="showPersistentToast"
        >
          Persistent Toast
        </UiButton>
        <UiButton
          variant="tertiary"
          @click="showCustomDurationToast"
        >
          10s Duration Toast
        </UiButton>
      </div>
    </div>

    <div :class="$style.section">
      <h2 :class="$style.sectionTitle">
        Controls
      </h2>
      <div :class="$style.buttonGrid">
        <UiButton
          variant="danger"
          @click="clearAllToasts"
        >
          Clear All Toasts
        </UiButton>
        <UiButton
          variant="primary"
          @click="showMultipleToasts"
        >
          Show Multiple Toasts
        </UiButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from '~/components/ui/composables/useToast'

const { success, error, warning, info, neutral, clear } = useToast()

const showInfoToast = () => {
  info('Information', {
    description: 'This is an informational message with some additional details about what happened.',
  })
}

const showSuccessToast = () => {
  success('Success!', {
    description: 'Your action was completed successfully. Everything went as expected.',
  })
}

const showWarningToast = () => {
  warning('Warning', {
    description: 'Please be careful. This action might have some consequences.',
  })
}

const showErrorToast = () => {
  error('Error Occurred', {
    description: 'Something went wrong. Please try again or contact support if the problem persists.',
  })
}

const showNeutralToast = () => {
  neutral('Neutral Message', {
    description: 'This is a neutral message that doesn\'t fall into other categories.',
  })
}

const showCompactInfoToast = () => {
  info('Compact Info', {
    size: 'compact',
    description: 'This is a compact toast notification.',
  })
}

const showCompactSuccessToast = () => {
  success('Compact Success', {
    size: 'compact',
    description: 'Compact success message.',
  })
}

const showCompactWarningToast = () => {
  warning('Compact Warning', {
    size: 'compact',
    description: 'Compact warning message.',
  })
}

const showCompactErrorToast = () => {
  error('Compact Error', {
    size: 'compact',
    description: 'Compact error message.',
  })
}

const showActionToast = () => {
  success('Task Completed', {
    description: 'Your task has been completed successfully.',
    actionText: 'View Details',
    onAction: () => {
      alert('Action button clicked!')
    },
  })
}

const showPersistentToast = () => {
  warning('Persistent Warning', {
    description: 'This toast will stay until you manually close it.',
    persistent: true,
    actionText: 'Take Action',
    onAction: () => {
      alert('Persistent toast action!')
    },
  })
}

const showCustomDurationToast = () => {
  info('Long Duration', {
    description: 'This toast will stay visible for 10 seconds.',
    duration: 10000,
  })
}

const clearAllToasts = () => {
  clear()
}

const showMultipleToasts = () => {
  setTimeout(() => info('First Toast', { description: 'This is the first toast' }), 0)
  setTimeout(() => success('Second Toast', { description: 'This is the second toast' }), 500)
  setTimeout(() => warning('Third Toast', { description: 'This is the third toast' }), 1000)
  setTimeout(() => error('Fourth Toast', { description: 'This is the fourth toast' }), 1500)
}
</script>

<style module lang="scss">
.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 40px 20px;
}

.header {
  text-align: center;
  margin-bottom: 40px;
}

.title {
  font-size: 32px;
  font-weight: 700;
  color: #f7f8f9;
  margin: 0 0 16px 0;
}

.description {
  font-size: 16px;
  color: #a0a0a0;
  margin: 0;
}

.section {
  margin-bottom: 40px;
}

.sectionTitle {
  font-size: 24px;
  font-weight: 600;
  color: #f7f8f9;
  margin: 0 0 20px 0;
}

.buttonGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

@media (max-width: 768px) {
  .container {
    padding: 20px 16px;
  }

  .title {
    font-size: 24px;
  }

  .sectionTitle {
    font-size: 20px;
  }

  .buttonGrid {
    grid-template-columns: 1fr;
  }
}
</style>
