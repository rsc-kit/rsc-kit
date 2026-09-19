// The recipes, and whether they still describe this framework.
//
// The failure mode worth guarding is drift. A recipe is followed with
// confidence — that is what it is for — so one naming an import that no longer
// exists is worse than no recipe at all. The import check below reads the real
// package.json, so a renamed entry point fails here rather than in someone's
// editor.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOPICS, howTo, listTopics } from '../src/recipes'

const CORE = JSON.parse(
  readFileSync(join(import.meta.dir, '../../core/package.json'), 'utf-8'),
) as { exports: Record<string, unknown> }

const everyRecipe = TOPICS.map((topic) => howTo(topic)).join('\n')

describe('every topic is reachable', () => {
  test('each one answers with its own body', () => {
    for (const topic of TOPICS) {
      expect(howTo(topic)).toContain(`# ${topic}`)
    }
  })

  test('and is listed, so a recipe cannot be added and left unfindable', () => {
    const listed = listTopics()

    for (const topic of TOPICS) expect(listed).toContain(topic)
  })

  test('a near miss is answered rather than refused', () => {
    // Someone asks for "form" or "queries" and means the obvious thing.
    expect(howTo('form')).toContain('# forms')
    expect(howTo('action client')).toContain('# action-client')
    expect(howTo('PWA')).toContain('# pwa')
    expect(howTo('image')).toContain('# images')
  })

  test('and an unknown topic hands back the list rather than nothing', () => {
    const answer = howTo('graphql')

    expect(answer).toContain('No topic')
    expect(answer).toContain('forms')
  })
})

describe('the recipes still describe this package', () => {
  test('every @rsc-kit/core import they name is a real entry point', () => {
    // The drift guard. A renamed export fails here rather than in the editor of
    // whoever followed the recipe.
    const named = [...everyRecipe.matchAll(/@rsc-kit\/core\/([\w-]+)/g)].map((m) => m[1])

    expect(named.length).toBeGreaterThan(5)

    for (const entry of new Set(named)) {
      expect(Object.keys(CORE.exports)).toContain(`./${entry}`)
    }
  })

  test('they cover what the framework actually has', () => {
    // If a feature ships without a recipe, an agent will invent one from Next.
    for (const must of [
      'forms',
      'prefetch',
      'validation',
      'action-client',
      'data',
      'suspense',
      'offline',
      'pwa',
      'no-javascript',
      'api-routes',
      'authorization',
      'emails',
      'seo-files',
      'domains',
      'identify',
      'env',
      'live-data',
      'dynamic',
    ]) {
      expect(TOPICS).toContain(must)
    }
  })

  test('the data recipe names both cache libraries and neither of ours', () => {
    // The standing decision: transport is ours, caching is theirs.
    const data = howTo('data')

    expect(data).toContain('useQuery')
    expect(data).toContain('useSWR')
    expect(data).toContain('fetchQuery')
  })

  test('images say where the optimizer is not', () => {
    const images = howTo('images')

    expect(images).toContain('@unpic/react')
    expect(images).toContain('vite-imagetools')
    expect(images).toContain('NO image server')
    expect(images).not.toContain('next/image is fine')
  })

  test('the forms recipe says a client schema is not a control', () => {
    // The dangerous half-truth: someone reads "schema validates the form" and
    // stops checking on the server.
    expect(howTo('forms')).toContain('never a control')
  })

  test('the authorization recipe says middleware does not cover actions', () => {
    expect(howTo('authorization')).toContain('middleware does NOT run')
  })
})
