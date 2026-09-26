/** Short commit hash injected by vite.config.ts (`define`); `dev` outside CI. */
declare const __BUILD__: string;
/** `version` from package.json and the date of the commit being built (vite.config.ts). */
declare const __VERSION__: string;
declare const __BUILD_DATE__: string;
/** Installed versions of the packages behind the runtime assets (`scripts/asset-versions.mjs`), injected by Vite. */
declare const __ASSET_VERSIONS__: { ocr: string; mediapipe: string; c2pa: string; zxing: string };
