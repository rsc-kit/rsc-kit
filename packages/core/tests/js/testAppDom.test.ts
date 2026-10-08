/**
 * createTestApp refuses a registered DOM, loudly and at once.
 *
 * Found when a project put happy-dom in its shared preload: 193 of 275 tests
 * failed, every signed-in page bouncing to sign-in, because happy-dom's
 * Request drops the Cookie header a browser would not let a script set. The
 * cause is a global; the symptom was everywhere else.
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, expect, test } from 'bun:test'
import { createTestApp } from '../../src/testing'

afterEach(() => {
  if (GlobalRegistrator.isRegistered) GlobalRegistrator.unregister()
})

test('says what is wrong and what to do, before building anything', async () => {
  GlobalRegistrator.register({ url: 'https://example.test/' })

  const error = (await createTestApp({ root: '/nonexistent', build: false }).catch((e) => e)) as Error

  expect(error.message).toContain("running against a browser's Request")
  expect(error.message).toContain('GlobalRegistrator.unregister()')
  expect(error.message).toContain('--isolate')
})

test('and is not the error once the DOM is gone', async () => {
  GlobalRegistrator.register({ url: 'https://example.test/' })
  GlobalRegistrator.unregister()

  const error = (await createTestApp({ root: '/nonexistent', build: false }).catch((e) => e)) as Error

  expect(error.message).not.toContain("browser's Request")
})
