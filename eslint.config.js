// Мягкая проверка кода: только то, что почти всегда ошибка. Форматирование не проверяем (репозиторий не отформатирован Prettier).
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist*/**', 'legacy-vanilla/**', 'supabase/functions/**', 'test-results/**', 'playwright-report/**', 'coverage/**', 'public/**', 'src/components/iconData.ts'] },
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Неиспользуемое — ошибка, но имя с подчёркиванием означает «нарочно»
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    // В тестах `any` допустим (заглушки и подмены); сценарные скрипты на CommonJS используют require
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**', 'e2e/**', 'src/**/__fixtures__/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  { files: ['scripts/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
