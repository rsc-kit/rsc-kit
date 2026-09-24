import { expect, type Page } from '@playwright/test'
import { headingFor } from '../src/data'

/** A phone's CPU: the timing bugs only showed under it. */
export async function slowCpu(page: Page, rate = 4): Promise<void> {
  const cdp = await page.context().newCDPSession(page)

  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
}

export async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as { __rsc_hydrated?: boolean }).__rsc_hydrated === true)
}

/** The heading a person sees - held pages are in the DOM too, hidden. */
export const heading = (page: Page) => page.locator('h1:visible')

/**
 * The page on screen is the page in the bar. The check that caught a
 * navigation which changed the url and left the old page showing.
 */
export async function showing(page: Page, path: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  await expect(heading(page)).toHaveText(headingFor(path))
}

/** Tap a link by its href, the way a thumb does. */
export async function tapLink(page: Page, href: string): Promise<void> {
  await page.locator(`a[href="${href}"]:visible`).first().tap()
}

/** Deterministic randomness, so a failing walk can be replayed. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 2 ** 32
  }
}
