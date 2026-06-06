/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          700: '#1e293b',
          800: '#0f172a',
          900: '#020617',
        },
        accent: {
          DEFAULT: '#6366f1',
          light: '#818cf8',
          dark: '#4f46e5',
          glow: 'rgba(99,102,241,0.15)',
        },
      },
      boxShadow: {
        glow: '0 0 20px rgba(99,102,241,0.2)',
        card: '0 4px 24px rgba(0,0,0,0.06)',
        'card-dark': '0 4px 24px rgba(0,0,0,0.3)',
        'card-hover': '0 8px 40px rgba(0,0,0,0.12)',
      },
      backgroundImage: {
        'glass-light':
          'linear-gradient(135deg, rgba(255,255,255,0.7), rgba(255,255,255,0.4))',
        'glass-dark':
          'linear-gradient(135deg, rgba(15,23,42,0.7), rgba(30,41,59,0.5))',
      },
    },
  },
  plugins: [],
};
