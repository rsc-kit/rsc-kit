/**
 * A change made straight in the database, by a trigger.
 *
 * Nothing watches a table: a section refreshes when a name's version moves, and a
 * `psql` session or another app that writes the data says nothing. A trigger on the
 * data table that upserts the version row, in the same transaction as the write,
 * is the same as `changed()` - and it moves with the commit, so a tab can never
 * ask for the new version and render the old data. These are the statements the
 * live-data guide gives, run against SQLite.
 */

import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { sqlVersions } from '../../src/changed'

const NAME = 'team:1:repos'

function setup() {
  const db = new Database(':memory:')

  db.run('CREATE TABLE rsc_versions (name TEXT PRIMARY KEY, version BIGINT NOT NULL)')
  db.run('CREATE TABLE repos (id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL, name TEXT NOT NULL)')

  // One trigger per statement kind: SQLite has no `INSERT OR UPDATE OR DELETE`.
  for (const [event, row] of [['INSERT', 'NEW'], ['UPDATE', 'NEW'], ['DELETE', 'OLD']] as const) {
    db.run(`
      CREATE TRIGGER repos_${event.toLowerCase()} AFTER ${event} ON repos
      BEGIN
        INSERT INTO rsc_versions (name, version)
        VALUES ('team:' || ${row}.team_id || ':repos', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
        ON CONFLICT (name) DO UPDATE SET version = MAX(excluded.version, rsc_versions.version + 1);
      END
    `)
  }

  const source = sqlVersions({
    dialect: 'sqlite',
    query: async (text, params) => db.query(text).all(...(params as string[])) as Record<string, unknown>[],
  })

  return { db, source }
}

describe('a trigger that moves the version row', () => {
  test('a write straight in the database moves the name, with nothing calling changed()', async () => {
    const { db, source } = setup()

    expect(await source.changed({ [NAME]: -1 }, 0)).toEqual({ [NAME]: 0 })

    db.run("INSERT INTO repos (team_id, name) VALUES (1, 'blog')")

    const moved = (await source.changed({ [NAME]: 0 }, 0))[NAME]!

    expect(moved).toBeGreaterThan(0)
    // Only the team that changed: another team's name did not move.
    expect(await source.changed({ 'team:2:repos': 0 }, 0)).toEqual({})
  })

  test('an update and a delete move it again, and never to a value a tab already holds', async () => {
    const { db, source } = setup()

    db.run("INSERT INTO repos (team_id, name) VALUES (1, 'blog')")
    const first = (await source.changed({ [NAME]: 0 }, 0))[NAME]!

    db.run("UPDATE repos SET name = 'docs' WHERE id = 1")
    const second = (await source.changed({ [NAME]: first }, 0))[NAME]!

    db.run('DELETE FROM repos WHERE id = 1')
    const third = (await source.changed({ [NAME]: second }, 0))[NAME]!

    // Within one millisecond, a clock alone would repeat itself. One past the last value does not.
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })

  test('a transaction that rolls back moves nothing: the version commits with the data', async () => {
    const { db, source } = setup()

    db.run('BEGIN')
    db.run("INSERT INTO repos (team_id, name) VALUES (1, 'blog')")
    db.run('ROLLBACK')

    expect(await source.changed({ [NAME]: 0 }, 0)).toEqual({})
  })
})
