/**
 * Form field types, checked by the typechecker rather than at runtime.
 *
 * The field name drives the value type — narrowed from `defaultValues`, the way
 * TanStack Form does it — and the errors are keyed by the same names. A typo
 * should be a type error rather than an `undefined` that shows up as an empty
 * input nobody can explain.
 *
 * Not a .test.tsx: there is no runtime behaviour here to assert.
 * `bun run typecheck` is what runs it.
 */

import Form from '../../src/js/Form'

declare const noop: (node: unknown) => void

noop(
  <Form action={async () => ({})} defaultValues={{ title: 'a', count: 1 }}>
    {({ field, error }) => {
      const title: string = field('title').value
      const count: number = field('count').value

      // @ts-expect-error the value type follows the name
      const wrongType: number = field('title').value
      // @ts-expect-error a name that is not a field does not compile
      const typo = field('titel')
      const realError: string | undefined = error('title')

      // Error names are deliberately NOT closed, and this is the reason: a
      // nested or indexed path is a real field name that no defaultValues
      // object can declare. Closing the set would make the repeating-group
      // case untypeable, which is worse than letting a typo through here —
      // the typo is caught on `field()` above, where it matters.
      const nested: string | undefined = error('address.city')
      const indexed: string | undefined = error(`items[0].name`)
      const wrongError: string | undefined = error('titel')

      return String([title, count, wrongType, typo, wrongError, realError, nested, indexed])
    }}
  </Form>,
)

// Without defaultValues there is nothing to narrow from, and everything is
// permitted — which is what a form that has not declared its shape should get.
noop(
  <Form action={async () => ({})}>
    {({ field, error }) => String([field('anything').value, error('anything')])}
  </Form>,
)
