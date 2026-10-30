// Crash guard: a render error in one part of the UI shows a small recovery
// card instead of blanking the whole app. The game record, settings and the
// engine worker live outside the component tree, so "Try again" usually just
// works; "Reset settings" covers a crash caused by a bad stored setting.

import { Component, type ComponentChildren } from 'preact';
import { clearStoredSettings } from '../state/settings';

interface Props {
  /** Shown in the card and the console ("board", "editor", ...). */
  area: string;
  /** Full-screen card with reset options (root boundary) or a compact one. */
  root?: boolean;
  /** Called when the user dismisses a non-root error (e.g. close the editor). */
  onDismiss?: () => void;
  children: ComponentChildren;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown): void {
    console.error(`[ui:${this.props.area}]`, error);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { root, area, onDismiss } = this.props;
    return (
      <div class={`crash ${root ? 'root' : ''}`} role="alert">
        <div class="crash-card glass">
          <div class="crash-emoji">🛠️</div>
          <h2>Something went wrong</h2>
          <p class="hint">
            The {area} hit an error. Your game is saved. <code>{error.message.slice(0, 140)}</code>
          </p>
          <div class="crash-actions">
            <button class="btn primary" onClick={this.retry}>
              Try again
            </button>
            {onDismiss && (
              <button
                class="btn"
                onClick={() => {
                  this.retry();
                  onDismiss();
                }}
              >
                Close
              </button>
            )}
            <button class="btn" onClick={() => location.reload()}>
              Reload
            </button>
            {root && (
              <button
                class="btn danger"
                onClick={() => {
                  clearStoredSettings();
                  location.reload();
                }}
              >
                Reset settings &amp; reload
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

/** Errors outside the component tree (event handlers, workers, promises). */
export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (e) => console.error('[app] uncaught', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('[app] unhandled rejection', e.reason));
}
