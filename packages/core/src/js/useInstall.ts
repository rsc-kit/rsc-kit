"use client";

/**
 * Installing the app, from a button of its own.
 *
 *     const { canInstall, install, installed, ios } = useInstall()
 *
 *     {canInstall && <button onClick={install}>Install</button>}
 *     {ios && !installed && <p>Share, then Add to Home Screen</p>}
 *
 * `canInstall` - the browser has offered, and `install()` will show its
 * dialog. Chrome, Edge and Android. The offer is caught by the page's inline
 * bootstrap before anything else runs (see installCapture.ts), so a button
 * that mounts late still gets it.
 *
 * `ios` - Safari on an iPhone or iPad, where there is no offer to catch and
 * installing is Share, then Add to Home Screen. The app says so; nothing can
 * do it for the visitor.
 *
 * `installed` - running as the installed app, or installed while this page
 * was open. For hiding the button, or for anything that should differ in the
 * app's own window.
 */

import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallState {
  canInstall: boolean;
  installed: boolean;
  ios: boolean;
}

type Captured = {
  __rsc_install_prompt?: InstallPrompt | null;
  __rsc_installed?: boolean;
};

const listeners = new Set<() => void>();
const SERVER: InstallState = { canInstall: false, installed: false, ios: false };
let current: InstallState = SERVER;

function standalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function onIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS asks for the desktop site and says it is a Mac.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** The snapshot, replaced only when something changed - useSyncExternalStore compares by identity. */
function read(): InstallState {
  const w = window as unknown as Captured;
  const installed = w.__rsc_installed === true || standalone();
  const next: InstallState = {
    canInstall: !installed && w.__rsc_install_prompt != null,
    installed,
    ios: !installed && onIos(),
  };

  if (next.canInstall !== current.canInstall || next.installed !== current.installed || next.ios !== current.ios) {
    current = next;
  }

  return current;
}

function notify(): void {
  for (const listener of listeners) listener();
}

let listening = false;

/**
 * The browser's own events, from the first subscriber on. Anything that came
 * before that is already on the window - the page's bootstrap kept it - so
 * listening from here misses nothing, and a page that never renders the hook
 * never listens.
 */
function listen(): void {
  if (listening) return;

  listening = true;

  const w = window as unknown as Captured;

  window.addEventListener("beforeinstallprompt", (event) => {
    w.__rsc_install_prompt = event as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    w.__rsc_install_prompt = null;
    w.__rsc_installed = true;
    notify();
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", notify);
}

function subscribe(listener: () => void): () => void {
  listen();
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/**
 * Show the browser's install dialog. Resolves with what the visitor chose,
 * or `unavailable` when there is no offer to act on - on iOS, in a browser
 * that makes none, or once it has been used: an offer can be shown once.
 */
async function install(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const w = window as unknown as Captured;
  const offer = w.__rsc_install_prompt;

  if (!offer) return "unavailable";

  w.__rsc_install_prompt = null;
  notify();
  await offer.prompt();

  return (await offer.userChoice).outcome;
}

export function useInstall(): InstallState & { install: typeof install } {
  const state = useSyncExternalStore(subscribe, read, () => SERVER);

  return { ...state, install };
}

export default useInstall;
