/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
        },
      },
      fontFamily: {
        serif: ['ui-serif', 'Georgia', 'Songti SC', 'serif'],
        kai: ['Kaiti SC', 'STKaiti', 'serif'],
        mono: ['ui-monospace', 'Menlo', 'monospace'],
      },
      keyframes: {
        eq: {
          '0%, 100%': { transform: 'scaleY(0.4)' },
          '50%': { transform: 'scaleY(1)' },
        },
        rise: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
      },
      animation: {
        eq: 'eq 0.8s ease-in-out infinite',
        rise: 'rise 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
