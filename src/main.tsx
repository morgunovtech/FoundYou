import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

// Design-system conventions (see public/ds/v1/USAGE.md):
// `data-js` on <html> tells components.css that the dropdown controller is
// live, so its :focus-within fallback can step aside.
document.documentElement.setAttribute('data-js', '');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>
);

// The theme attribute is applied before the stylesheets arrive; `no-transition`
// on <body> keeps every themed surface from animating out of its unstyled
// state on load. Two frames later the first paint is done and transitions may
// resume for the interactive theme switch.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.body.classList.remove('no-transition');
  });
});
