// Not a client module: the panel's server layout reads the string, and a
// "use client" file would hand it a client reference instead.

export const THEME_KEY = 'rsc-kit-admin-theme'

/**
 * Applies the stored theme, or the system's, before the first paint - as an
 * inline script at the top of the panel, so a dark system never shows a light
 * page first. A string, so it runs without React.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')}catch(e){}var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'})()`
