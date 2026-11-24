/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** package.json version, injected by vite.config.ts. */
declare const __APP_VERSION__: string;
/** ISO time of the production build (or dev server start). */
declare const __BUILD_TIME__: string;
/** True in the copy bundled into the native iOS app (`vite build --mode native`). */
declare const __NATIVE__: boolean;
