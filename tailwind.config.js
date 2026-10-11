/** @type {import('tailwindcss').Config} */

// Цвета берутся из CSS-переменных (src/index.css), поэтому светлая/тёмная тема переключается без dark:-классов.
// Переменные хранят «R G B», чтобы работали модификаторы прозрачности: bg-brand/10.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2') },
        text: v('text'),
        muted: v('muted'),
        border: { DEFAULT: v('border'), strong: v('border-strong') },
        brand: { DEFAULT: v('brand'), fg: v('on-brand'), dark: v('brand-hover') },
        danger: v('danger'),
        income: v('income'),
        expense: v('expense'),
        warning: v('warning'),
      },
      fontFamily: {
        // Системный шрифт: приложение работает офлайн, веб-шрифты не грузим.
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          '"Noto Sans"',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Noto Color Emoji"',
        ],
      },
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.06)',
        sheet: '0 -8px 32px rgb(0 0 0 / 0.18)',
        float: '0 8px 24px rgb(0 0 0 / 0.18)',
      },
      keyframes: {
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'sheet-up': 'sheet-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'fade-in': 'fade-in 160ms ease-out',
        'pop-in': 'pop-in 180ms ease-out',
      },
    },
  },
  plugins: [],
};
