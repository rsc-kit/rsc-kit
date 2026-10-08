import { expect, test } from '@playwright/test'
import { hydrated } from './helpers'

// A stub the build generates for a backend action is a plain "use server"
// function, and when the backend refuses it the stub throws. Only a validation
// error thrown from one was turned into a result; a refusal reached the browser
// as React's opaque error, and the message the backend wrote for the person
// asking - "busy, try again in a minute" - never reached the form.
test('a refusal thrown from a plain action reaches the form as its message', async ({ page }) => {
  await page.goto('/refusal')
  await hydrated(page)

  await page.locator('#submit').click()

  await expect(page.locator('#form-error')).toHaveText('The queue is busy, try again in a minute')
  await expect(page.getByText('An error occurred')).toHaveCount(0)
})
