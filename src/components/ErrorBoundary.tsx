import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * `page` (default) replaces the whole app with a full-screen fallback.
   * `inline` renders a compact `.fy-error` box in place of the failed
   * section, so one crashing block does not take the rest of the page down.
   */
  variant?: 'page' | 'inline';
  /** When this value changes, a caught error is cleared (e.g. pass the current file). */
  resetKey?: unknown;
  /**
   * Labels from the dictionary, for the inline variant, which always mounts inside
   * `I18nProvider`; only the page variant has to carry its own three languages.
   */
  labels?: { inlineTitle: string; retry: string };
}

interface ErrorBoundaryState {
  hasError: boolean;
  details?: string;
}

const FALLBACK_LABELS: Record<string, { title: string; inlineTitle: string; retry: string; reload: string }> = {
  ru: {
    title: 'Что-то пошло не так',
    inlineTitle: 'Этот блок не удалось отобразить.',
    retry: 'Попробовать снова',
    reload: 'Перезагрузить страницу'
  },
  en: {
    title: 'Something went wrong',
    inlineTitle: 'This section failed to render.',
    retry: 'Try again',
    reload: 'Reload the page'
  },
  uz: {
    title: 'Xatolik yuz berdi',
    inlineTitle: 'Bu bo‘limni ko‘rsatib bo‘lmadi.',
    retry: 'Qayta urinish',
    reload: 'Sahifani qayta yuklash'
  }
};

function getLabels() {
  if (typeof document === 'undefined') return FALLBACK_LABELS.en;
  const lang = document.documentElement.lang || 'ru';
  return FALLBACK_LABELS[lang] ?? FALLBACK_LABELS.en;
}

/**
 * Error boundary with two faces. The page variant is the last resort mounted
 * outside the i18n provider, hence the inline labels; the design-system
 * chrome (fonts, tokens) still applies because it is linked from index.html.
 * The inline variant wraps individual result sections in App.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, details: error?.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('app-error', error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, details: undefined });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, details: undefined });
  };

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      const labels = this.props.labels ? { ...getLabels(), ...this.props.labels } : getLabels();
      if (this.props.variant === 'inline') {
        return (
          <div className="v4-section">
            <div className="fy-error" role="alert">
              <span>{labels.inlineTitle}</span>
              <div className="fy-error-actions">
                <button type="button" className="v4-btn fy-btn-sm" onClick={this.handleReset}>
                  {labels.retry}
                </button>
              </div>
            </div>
          </div>
        );
      }
      return (
        <div className="v4-root">
          <div className="fy-error-page" role="alert">
            <h1>{labels.title}</h1>
            <div className="fy-actions">
              <button type="button" className="v4-btn v4-btn-primary" onClick={this.handleReset}>
                {labels.retry}
              </button>
              <button type="button" className="v4-btn" onClick={this.handleReload}>
                {labels.reload}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
