/**
 * Component names a second bundler cannot change.
 *
 * A replay matches each slot by `type.displayName || type.name`, and
 * `bun build --compile` renames whatever collides when it merges module
 * scopes - measured, --keep-names or not:
 *
 *   { a: "Widget", b: "Widget2" }
 *
 * A clean app compiled to a binary could not finish a single partially
 * prerendered page: the engine's own PathnameProvider collided, the shell
 * said <PathnameProvider>, the binary rendered <PathnameProvider2>, and
 * every hole fell to the browser. The same app with these stamps, the same
 * compile command, no flags: every hole filled at the origin.
 */

import { describe, expect, test } from 'bun:test'
import { parseAst } from 'vite'
import { componentBindings, displayNameStamp, stampDisplayNames } from '../../src/stableNames'

const parse = (code: string) => parseAst(code) as never

/** What a scope-merging bundler does to a binding that collides. */
function renamed(code: string, from: string, to: string): string {
  return code.replace(new RegExp(`\\b${from}\\b(?!")`, 'g'), to)
}

/** Run a module's code and hand back what it declared. */
function evaluate(code: string, names: string[]): Record<string, unknown> {
  const body = code.replace(/^export\s+(default\s+)?/gm, '') + `\nreturn { ${names.join(', ')} }`

  return new Function('memo', 'forwardRef', body)(
    (inner: unknown) => ({ $$typeof: Symbol.for('react.memo'), type: inner }),
    (render: unknown) => ({ $$typeof: Symbol.for('react.forward_ref'), render }),
  )
}

describe('which bindings are stamped', () => {
  test('every top-level function, class, and value that could be a component', () => {
    const code = `
      function Plain() {}
      class Klass {}
      var Arrow = () => 1, Expr = function () {};
      const Memo = memo(function Inner() {});
      export function Exported() {}
      export const ExportedArrow = () => 1;
      export default function Page() {}
      const count = 3, label = "x", list = [];
    `

    expect(componentBindings(parse(code)).sort()).toEqual(
      ['Arrow', 'Exported', 'ExportedArrow', 'Expr', 'Klass', 'Memo', 'Page', 'Plain'].sort(),
    )
  })

  test('only the top level: a nested function is not what a scope merge renames', () => {
    expect(componentBindings(parse('function Outer() { function Inner() {} return Inner }'))).toEqual(['Outer'])
  })

  test('a chunk with nothing to stamp is left as it was', () => {
    const code = 'const count = 3;\nexport { count };\n'

    expect(stampDisplayNames(code, parse)).toBe(code)
    expect(displayNameStamp([])).toBe('')
  })

  test('a chunk that cannot be parsed is left as it was, not broken', () => {
    const code = 'this is not javascript {'

    expect(stampDisplayNames(code, () => {
      throw new Error('unparseable')
    })).toBe(code)
  })
})

describe('what a component is called after a second bundler renames it', () => {
  test('the name it had in the build, not the one the merge gave it', () => {
    // The build's output, stamped; then the binding renamed the way a merge
    // renames a collision. React reads displayName first.
    const stamped = stampDisplayNames('function Label() { return null }', parse)
    const merged = renamed(stamped, 'Label', 'Label2')
    const { Label2 } = evaluate(merged, ['Label2']) as { Label2: { name: string; displayName?: string } }

    expect(Label2.name).toBe('Label2')
    expect(Label2.displayName).toBe('Label')
  })

  test('two different components of one name keep one name each', () => {
    // The port's shape: its TooltipProvider wrapping a library's.
    const one = stampDisplayNames('function TooltipProvider() { return 1 }', parse)
    const two = renamed(stampDisplayNames('function TooltipProvider() { return 2 }', parse), 'TooltipProvider', 'TooltipProvider2')
    const a = evaluate(one, ['TooltipProvider']).TooltipProvider as { displayName: string }
    const b = evaluate(two, ['TooltipProvider2']).TooltipProvider2 as { displayName: string }

    expect(a.displayName).toBe('TooltipProvider')
    expect(b.displayName).toBe('TooltipProvider')
  })

  test('memo and forwardRef wrappers are named too - React reads theirs first', () => {
    const code = 'const Card = memo(function () {});\nconst Field = forwardRef(function () {});'
    const merged = renamed(renamed(stampDisplayNames(code, parse), 'Card', 'Card2'), 'Field', 'Field2')
    const { Card2, Field2 } = evaluate(merged, ['Card2', 'Field2']) as Record<string, { displayName?: string }>

    expect(Card2.displayName).toBe('Card')
    expect(Field2.displayName).toBe('Field')
  })

  test('a displayName the code set itself is kept', () => {
    const code = 'function Button() {}\nButton.displayName = "Primitive.Button";'
    const { Button } = evaluate(stampDisplayNames(code, parse), ['Button']) as { Button: { displayName: string } }

    expect(Button.displayName).toBe('Primitive.Button')
  })

  test('a call that returned something other than a component is skipped without throwing', () => {
    const code = 'const config = Object.freeze({ a: 1 });\nconst text = String(1);\nconst frozen = Object.freeze(function Frozen() {});'
    const values = evaluate(stampDisplayNames(code, parse), ['config', 'text', 'frozen']) as Record<string, unknown>

    expect(values.config).toEqual({ a: 1 })
    expect(values.text).toBe('1')
    expect((values.frozen as { name: string }).name).toBe('Frozen')
  })
})
