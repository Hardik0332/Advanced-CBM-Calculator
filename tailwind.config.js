/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        /* ── Warm-neutral foundation (replaces cold slate + indigo wash) ── */
        surface: {
          50: '#faf9f7',
          100: '#f4f2ef',
          150: '#ece9e4',
          200: '#e2ded7',
          300: '#cdc7bd',   /* borders, dividers, decorative */
          400: '#a09890',   /* placeholder text, disabled */
          500: '#7a726a',   /* muted labels, secondary text (AA on surface-50) */
          600: '#57504a',   /* body text, captions */
          700: '#211f1c',   /* dark-mode surfaces (unchanged) */
          800: '#191714',   /* dark-mode panel bg (unchanged) */
          900: '#100f0d',   /* dark-mode page bg (unchanged) */
        },
        /* ── Single deliberate accent: deep teal-green ── */
        accent: {
          50: '#eafaf5',
          100: '#cef1e7',
          200: '#9fe0cf',
          300: '#63c8b1',
          400: '#2ea88e',
          500: '#0d7d6e',
          DEFAULT: '#0d7d6e',
          600: '#0a6659',
          700: '#0a534a',
          800: '#0b423c',
          900: '#0a3733',
          950: '#052420',
        },
      },
      boxShadow: {
        /* One restrained elevation used sparingly (modals, toasts, popovers). */
        panel: '0 1px 2px rgba(16,15,13,0.04)',
        pop: '0 8px 28px -6px rgba(16,15,13,0.16), 0 2px 6px -2px rgba(16,15,13,0.08)',
        'pop-dark': '0 12px 40px -8px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};
