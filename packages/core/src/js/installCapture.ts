/**
 * Catching the browser's offer to install, before anything could miss it.
 *
 * Chrome, Edge and Android fire `beforeinstallprompt` once, when the page
 * qualifies - and nothing says that is after a component's effect has run. An
 * app that listened in `useEffect` missed it, and then had no way to offer an
 * install button until a reload. So the listener is in the inline bootstrap,
 * ahead of the runtime, and the event is kept on the window for useInstall to
 * take. Only in an app that declares a manifest: nothing else can be installed,
 * so nothing else pays the bytes.
 *
 * The browser's own install UI is left alone - no preventDefault - so an app
 * that shows no button of its own loses nothing.
 */
export const INSTALL_CAPTURE =
  "(function(){var w=window;w.addEventListener('beforeinstallprompt',function(e){w.__rsc_install_prompt=e});" +
  "w.addEventListener('appinstalled',function(){w.__rsc_install_prompt=null;w.__rsc_installed=true})})();"
