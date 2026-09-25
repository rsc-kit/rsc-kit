/**
 * Installing the app from a button of its own.
 *
 * The offer - beforeinstallprompt - comes once, whenever the page qualifies,
 * and an app listening in an effect could miss it for good. The page's inline
 * bootstrap keeps it on the window (installCapture.ts); these check the hook
 * takes it from there, uses it once, and says what is true on iOS, where
 * there is no offer at all.
 */

import { registerDom } from './dom'

registerDom()

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'bun:test'
import { INSTALL_CAPTURE } from '../../src/js/installCapture'
import { useInstall } from '../../src/js/useInstall'

type Seen = ReturnType<typeof useInstall>

const w = window as unknown as { __rsc_install_prompt?: unknown; __rsc_installed?: boolean }
let container: HTMLElement
let root: ReturnType<typeof createRoot>

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  delete w.__rsc_install_prompt
  delete w.__rsc_installed
})

async function mount(): Promise<() => Seen> {
  let seen!: Seen

  function Probe() {
    seen = useInstall()

    return null
  }

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Probe />))

  return () => seen
}

/** What Chrome hands the page: an event with prompt() and a userChoice. */
function offer(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
  let prompted = 0

  event.prompt = async () => {
    prompted++
  }
  event.userChoice = Promise.resolve({ outcome })

  return { event, prompted: () => prompted }
}

describe('an offer to install', () => {
  test('caught by the bootstrap before anything mounted is still there for the button', async () => {
    // What the inline script does, run before the component exists.
    new Function(INSTALL_CAPTURE)()
    const { event } = offer('accepted')

    window.dispatchEvent(event)

    const seen = await mount()

    expect(seen().canInstall).toBe(true)
    expect(seen().installed).toBe(false)
  })

  test('install() shows the dialog once, says what was chosen, and is spent', async () => {
    const { event, prompted } = offer('accepted')
    const seen = await mount()

    await act(async () => {
      window.dispatchEvent(event)
    })

    expect(seen().canInstall).toBe(true)

    let outcome = ''

    await act(async () => {
      outcome = await seen().install()
    })

    expect(outcome).toBe('accepted')
    expect(prompted()).toBe(1)
    expect(seen().canInstall).toBe(false)

    // An offer can be shown once.
    await act(async () => {
      outcome = await seen().install()
    })

    expect(outcome).toBe('unavailable')
  })

  test('dismissed is an answer too', async () => {
    const { event } = offer('dismissed')
    const seen = await mount()

    await act(async () => {
      window.dispatchEvent(event)
    })

    let outcome = ''

    await act(async () => {
      outcome = await seen().install()
    })

    expect(outcome).toBe('dismissed')
  })

  test('with no offer, install() is unavailable rather than a hang', async () => {
    const seen = await mount()

    expect(seen().canInstall).toBe(false)
    expect(await seen().install()).toBe('unavailable')
  })
})

describe('installed', () => {
  test('once the browser says the app was installed, and there is no longer anything to offer', async () => {
    const seen = await mount()

    await act(async () => {
      window.dispatchEvent(offer('accepted').event)
    })
    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(seen().installed).toBe(true)
    expect(seen().canInstall).toBe(false)
  })
})

describe('on iOS', () => {
  test('there is no offer, so the hook says it is iOS for the app to explain Add to Home Screen', async () => {
    const real = Object.getOwnPropertyDescriptor(navigator, 'userAgent')

    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    })

    try {
      const seen = await mount()

      expect(seen().ios).toBe(true)
      expect(seen().canInstall).toBe(false)
    } finally {
      if (real) Object.defineProperty(navigator, 'userAgent', real)
      else delete (navigator as { userAgent?: string }).userAgent
    }
  })
})
