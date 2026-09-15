// Where a form's bound values live.
//
// Not React state, and that is the whole point. State in <Form> means every
// change re-renders everything the render prop returned — fine for the one or
// two fields a form usually binds, and the reason a field could not re-render
// on its own.
//
// A store can be subscribed to per field. A component calling useField('title')
// re-renders when `title` changes and at no other time, which is what
// react-hook-form's <Controller> achieves with a render prop and what this
// achieves without one.
//
// The form still re-renders for fields read through `field()` in the render
// prop, because that value is being read *in* the render prop and there is
// nowhere else for it to come from. Which of the two a field uses is the
// caller's choice, and the store is what makes the choice available.

export interface FormStore {
  get(name: string): unknown;
  all(): Record<string, unknown>;
  set(name: string, value: unknown): void;
  reset(values?: Record<string, unknown>): void;
  /** Called for every change, with the name that changed. */
  subscribe(listener: (name: string) => void): () => void;
}

export function createFormStore(initial: Record<string, unknown> = {}): FormStore {
  let values = { ...initial };
  const listeners = new Set<(name: string) => void>();

  return {
    get: (name) => values[name],
    all: () => values,
    set(name, value) {
      // Identity matters: useSyncExternalStore compares snapshots, and handing
      // back a value that did not change would still be a render.
      if (Object.is(values[name], value)) return;

      values = { ...values, [name]: value };
      listeners.forEach((fn) => fn(name));
    },
    reset(next) {
      values = { ...(next ?? initial) };
      // No name, so everything listening hears it. `reset` is the one change
      // that is not about a field.
      listeners.forEach((fn) => fn(""));
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
}
