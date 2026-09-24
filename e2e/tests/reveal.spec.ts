import { expect, test } from '@playwright/test'

// A stored shell and its holes arrive in one response. React's streaming
// keeps a painted fallback up for 300 ms from the moment the shell painted,
// so data that arrived a few milliseconds after that paint waited out the
// rest of the 300 - measured on a phone: the dashboard's numbers were on the
// device at 189 ms and on screen at 529. The fallback should give way as soon
// as what it stands for has arrived.
test('a stored shell reveals its hole when the data arrives, not 300 ms after the shell painted', async ({ page, request }) => {
  const stored = await (await request.get('/dash')).text()

  // The clock React starts at the shell's first paint is not in a stored shell.
  expect(stored).not.toContain('$RT=performance.now()});</script>')

  await page.addInitScript(() => {
    const w = window as unknown as { __shown?: number; __revealed?: number }

    new MutationObserver(() => {
      const skeleton = document.getElementById('dash-skeleton')

      if (w.__shown === undefined && skeleton) w.__shown = performance.now()
      // Revealed when the fallback is gone. The content itself is in the
      // document earlier than that - streamed into a hidden container, and
      // moved into place by React's reveal - so its arrival says nothing.
      if (w.__shown !== undefined && w.__revealed === undefined && !skeleton) w.__revealed = performance.now()
    }).observe(document, { childList: true, subtree: true })
  })

  const times: number[] = []

  for (let i = 0; i < 3; i++) {
    await page.goto('/dash')
    await expect(page.locator('#dash-data')).toBeVisible()

    const { shown, revealed, arrived } = await page.evaluate(() => {
      const w = window as unknown as { __shown?: number; __revealed?: number }
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming

      return { shown: w.__shown ?? 0, revealed: w.__revealed ?? 0, arrived: n.responseEnd }
    })

    // From the data being in the browser to it being on screen: a frame or
    // two, not the rest of a 300 ms window.
    times.push(Math.round(revealed - Math.max(arrived, shown)))
  }

  times.sort((a, b) => a - b)
  expect(times[1]).toBeLessThan(120)
})
