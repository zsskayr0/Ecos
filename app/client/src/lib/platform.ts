/**
 * Coarse platform detection — used only to decide whether "Neste
 * computador" (defaulting to `127.0.0.1`, the desktop sidecar model) makes
 * sense to offer at all: a phone can't usefully run `ecos-app` itself the
 * way a desktop can. No Tauri plugin added just for this — the WebView's
 * own user agent already carries "Android" reliably enough for a cosmetic
 * choice like this (never used for anything security-sensitive).
 */
export function ehAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}
