import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UpdatePromptHost } from './components/UpdatePrompt';
import './index.css';
import { applyTheme, readThemePref } from './theme';

// Тема применяется до первой отрисовки: страница не мигает не той темой.
applyTheme(readThemePref());

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
