/** @type {import('tailwindcss').Config} */

// Цвета берутся из CSS-переменных (src/index.css), поэтому светлая/тёмная тема переключается без dark:-классов.
// Переменные хранят «R G B», чтобы работали модификаторы прозрачности: bg-brand/10.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Тема выбирается человеком (data-theme на <html>, см. src/theme.ts), а «как в системе» атрибута не ставит, поэтому класс dark: НЕ
  // используется (в режиме «как в системе» он бы не сработал): весь цвет берётся из токенов выше, тест-страж — src/darkVariant.test.ts.
  // Селектор оставлен только затем, чтобы dark: не показывал тему системы, если его когда-нибудь добавят по ошибке.
  darkMode: ['selector', ':root[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2') },
        text: v('text'),
        muted: v('muted'),
        border: { DEFAULT: v('border'), strong: v('border-strong') },
        brand: { DEFAULT: v('brand'), fg: v('on-brand'), dark: v('brand-hover') },
        accent: v('accent'),
        hero: { DEFAULT: v('hero'), from: v('hero-from') },
        danger: v('danger'),
        'on-danger': v('on-danger'),
        income: v('income'),
        expense: v('expense'),
        warning: v('warning'),
      },
      // Шкала скруглений: поле/кнопка — control, карточка — card, «таблетка» и кружки — pill. Остальные значения — для особых случаев.
      borderRadius: { control: '0.75rem', card: '1.5rem', pill: '9999px' },
      fontSize: { caption: ['0.75rem', { lineHeight: '1rem' }] },
      fontFamily: {
        // Manrope вшит в приложение (src/assets/fonts), системные шрифты — запасные.
        sans: [
          'Manrope',
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
      transitionTimingFunction: { spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
      boxShadow: {
        card: '0 10px 34px -14px rgb(var(--glass-shadow) / 0.32), inset 0 1px 0 rgb(255 255 255 / 0.28)',
        sheet: '0 -8px 32px rgb(0 0 0 / 0.18)',
        float: '0 8px 24px rgb(0 0 0 / 0.18)',
      },
      keyframes: {
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        rise: { from: { opacity: '0', transform: 'translateY(14px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'sheet-up': 'sheet-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'fade-in': 'fade-in 160ms ease-out',
        'pop-in': 'pop-in 180ms ease-out',
        rise: 'rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
