/** Short commit hash injected by vite.config.ts (`define`); `dev` outside CI. */
declare const __BUILD__: string;
/** Installed versions of the packages behind the runtime assets (`scripts/asset-versions.mjs`), injected by Vite. */
declare const __ASSET_VERSIONS__: { ocr: string; mediapipe: string; c2pa: string; zxing: string };
