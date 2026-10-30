import { render } from 'preact';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles/app.css';
import './styles/classic.css';
import { App } from './app';
import { engine, startController } from './controller';
import { game } from './state/game';
import { installGlobalErrorLogging } from './ui/ErrorBoundary';
import { registerServiceWorker } from './ui/UpdateToast';
import { shieldViewport } from './viewport';

installGlobalErrorLogging();
shieldViewport();
// Safari 17.4+ renders <input switch> natively (with haptics); others get CSS.
document.documentElement.classList.toggle('has-switch', 'switch' in HTMLInputElement.prototype);
startController();
render(<App />, document.getElementById('app')!);
registerServiceWorker();

if (import.meta.env.DEV) {
  // Debug handles for the dev server only.
  Object.assign(window, { __gml: { engine, game } });
}
