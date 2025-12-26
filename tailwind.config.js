/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.vue',
    './components/layout/**/*.vue',
    './components/base/**/*.vue',
    './components/entities/**/*.vue',
    './app.vue',
    './error.vue',
    '!./components/ui/**/*.vue',
  ],

  theme: {
    extend: {
      spacing: {
        ...Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => [i, `${i}px`]),
        ),
      },

      colors: {
        'euler-dark': {
          100: 'hsl(var(--euler-dark-100))',
          200: 'hsl(var(--euler-dark-200))',
          300: 'hsl(var(--euler-dark-300))',
          400: 'hsl(var(--euler-dark-400))',
          500: 'hsl(var(--euler-dark-500))',
          600: 'hsl(var(--euler-dark-600))',
          700: 'hsl(var(--euler-dark-700))',
          800: 'hsl(var(--euler-dark-800))',
          900: 'hsl(var(--euler-dark-900))',
          1000: 'hsl(var(--euler-dark-1000))',
        },
        'aquamarine': {
          300: 'hsl(var(--aquamarine-300))',
          500: 'hsl(var(--aquamarine-500))',
          600: 'hsl(var(--aquamarine-600))',
          700: 'hsl(var(--aquamarine-700))',
          800: 'hsl(var(--aquamarine-800))',
          900: 'hsl(var(--aquamarine-900))',
          1000: 'hsl(var(--aquamarine-1000))',
        },
        'red': {
          600: 'rgb(var(--red-600))',
          700: 'rgb(var(--red-700))',
          800: 'rgb(var(--red-800))',
          1000: 'rgb(var(--red-1000))',
        },
        'green': {
          600: 'rgb(var(--green-600))',
          1000: 'rgb(var(--green-1000))',
        },
        'yellow': {
          600: 'rgb(var(--yellow-600))',
          700: 'rgb(var(--yellow-700))',
          1000: 'rgb(var(--yellow-1000))',
        },
        'orange': {
          1000: 'rgb(var(--orange-1000))',
        },
        'yellow-warning': {
          700: 'rgb(var(--yellow-warning-700))',
        },
        'slice-of-heaven': {
          300: 'rgb(var(--slice-of-heaven-300))',
        },
        'teal-light': {
          100: 'rgb(var(--teal-light-100))',
          300: 'rgb(var(--teal-light-300))',
        },
        'border-primary': 'hsl(var(--border-primary))',
      },

      screens: {
        mobile: { max: '900px' },
        laptop: { min: '901px' },
      },

      borderRadius: {
        8: '8px',
        12: '12px',
        16: '16px',
      },

      fontSize: {
        h1: ['32px', { lineHeight: '40px', fontWeight: '600' }],
        h2: ['24px', { lineHeight: '32px', fontWeight: '600' }],
        h3: ['20px', { lineHeight: '26px', fontWeight: '600' }],
        h4: ['18px', { lineHeight: '24px', fontWeight: '600' }],
        h5: ['16px', { lineHeight: '20px', fontWeight: '600' }],
        h6: ['14px', { lineHeight: '20px', fontWeight: '600' }],
        p1: ['24px', { lineHeight: '32px', fontWeight: '400' }],
        p2: ['16px', { lineHeight: '20px', fontWeight: '400' }],
        p3: ['14px', { lineHeight: '20px', fontWeight: '400' }],
      },

      maxWidth: {
        container: '800px',
      },

      zIndex: {
        100: '100',
      },

      transitionDuration: {
        default: '250ms',
        slow: '350ms',
        fast: '200ms',
      },
    },
  },

  plugins: [],
}
