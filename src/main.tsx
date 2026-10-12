import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UpdatePromptHost } from './components/UpdatePrompt';
import { startInstallCapture } from './install/installEvent';
import './index.css';
import { applyAccent, applyTheme, readAccentPref, readThemePref } from './theme';

// Тема и цвет акцента применяются до первой отрисовки: страница не мигает не той темой.
applyTheme(readThemePref());
applyAccent(readAccentPref());
// Событие «можно установить» приходит рано и один раз — ловим его при старте, а показываем окно позже.
startInstallCapture();

const container = document.getElementById('root');
if (!container) throw new Error('Не найден элемент #root в index.html');

// Подсказка об обновлении стоит снаружи App (а значит, и снаружи его ErrorBoundary): если выпущенная версия
// падает при отрисовке, исправленная версия всё равно доходит до человека.
createRoot(container).render(
  <StrictMode>
    <UpdatePromptHost>
      <App />
    </UpdatePromptHost>
  </StrictMode>,
);
