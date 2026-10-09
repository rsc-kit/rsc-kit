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

// The same stub awaited directly, typed Promise<void | Redirected>. It resolved
// the refusal as an object, so every caller took the success branch: a toast for
// a write that did not happen, a navigation to an id that never came back. It
// rejects now, with the backend's message and status.
test('a refusal awaited directly rejects with its message and status, and the success path does not run', async ({ page }) => {
  await page.goto('/refusal')
  await hydrated(page)

  await page.locator('#direct').click()

  await expect(page.locator('#direct')).toHaveText('refused 503: The queue is busy, try again in a minute')
})

// An input the backend refused, from a stub, resolved { validationErrors } typed
// as the result: a caller that navigated on what it got went to an undefined path
// on bad input. It rejects like a refusal does, with the fields on the error, and
// a form and useAction read it as they always did.
test('a stub whose input was refused rejects with its fields; the form and useAction still show them', async ({ page }) => {
  await page.goto('/refusal')
  await hydrated(page)

  await page.locator('#invalid-direct').click()
  await expect(page.locator('#invalid-direct')).toHaveText('invalid: Name is required / Check the form')

  await page.locator('#invalid-submit').click()
  await expect(page.locator('#invalid-field')).toHaveText('Name is required')
  await expect(page.locator('#invalid-form')).toHaveText('Check the form')

  await page.locator('#invalid-action').click()
  await expect(page.locator('#invalid-action')).toHaveText('Name is required')
})
