/**
 * The order the testing guide's recipe depends on: a DOM first, components
 * after. A library that checks for a DOM at import keeps what it found, so a
 * component imported before the DOM existed is the one whose dialogs never
 * open.
 */

import './domBeforeImports'

import { expect, test } from 'bun:test'

test('a component imported after the DOM is registered finds it', async () => {
  const { hadDomAtImport } = await import('./needsDomAtImport.fixture')

  expect(hadDomAtImport).toBe(true)
})
