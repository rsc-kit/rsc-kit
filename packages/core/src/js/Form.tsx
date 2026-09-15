"use client";

import type { Href } from "../routes.js";
import {
  type FormHTMLAttributes,
  type FormEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { ServerValidationError, ServerDumpError } from "./errors";
import { validateWith } from "./standardSchema";
import type { StandardSchemaV1 } from "./standardSchema";

type PrefetchStrategy = "hover" | "mount" | "none";

/**
 * What `field(name)` hands a control, spread straight onto it.
 *
 * The same four things react-hook-form's `<Controller>` gives, because it is
 * the same job: a component with no native control behind it needs a value and
 * a way to report a new one.
 */
interface FieldBinding {
  name: string;
  value: string;
  onChange: (next: unknown) => void;
  onBlur: () => void;
}

interface FormRenderProps<T extends Record<string, unknown> = Record<string, unknown>> {
  pending: boolean;
  data: T;
  errors: Record<string, string[]>;
  error: (field: keyof T & string) => string | undefined;
  clearErrors: (...fields: (keyof T & string)[]) => void;
  reset: () => void;
  /** Whether the last submit was accepted. */
  succeeded: boolean;
  /**
   * The same thing, for two seconds.
   *
   * The "Saved ✓" that appears and fades. Worth having as state rather than a
   * timer in every form that wants one, because the timer has to be cleared
   * when the component goes away and that is the part people forget.
   */
  recentlySucceeded: boolean;
  /**
   * Bind one field so this component holds its value.
   *
   * Most fields need nothing: they are uncontrolled, the DOM holds the value,
   * and it is read back as FormData on submit. Reach for this when the DOM
   * cannot hold it for you — a control with no native element behind it, or a
   * value you want to read as it is typed:
   *
   *     <Input {...field('title')} />
   *     <span>{field('body').value.length}/100</span>
   *
   * A bound field is still an ordinary named input, so it arrives in FormData
   * with everything else. Nothing merges; there is one source of truth.
   */
  field: (name: keyof T & string) => FieldBinding;
}

interface FormProps<T extends Record<string, unknown> = Record<string, unknown>>
  extends Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "method" | "children" | "onSubmit" | "onError"> {
  action: Href | ((formData: FormData) => Promise<unknown>);
  method?: "get" | "post";
  /**
   * Starting values for fields bound with `field()`.
   *
   * Uncontrolled fields do not need this — they take React's own
   * `defaultValue`, and the DOM keeps whatever is typed into them.
   */
  defaultValues?: Partial<T>;
  prefetch?: PrefetchStrategy;
  cacheFor?: number;
  replace?: boolean;
  preserveScroll?: boolean;
  resetOnSuccess?: boolean;
  /**
   * Check the fields before submitting, with any Standard Schema — Zod,
   * Valibot, ArkType.
   *
   * A failure fills `errors` and the action is never called, so a mistake
   * costs no round trip. It is a courtesy and not a control: the same action
   * is reachable without this form, so the server still has to check.
   */
  schema?: StandardSchemaV1;
  /** Transform form data before submitting to the server action. */
  transform?: (data: T) => Record<string, unknown>;
  /** Called inside the transition with typed form data. Use it to call your useOptimistic setter. */
  optimistic?: (data: T) => void;
  onSuccess?: (result: unknown) => void;
  /**
   * Called when a submit does not succeed.
   *
   * Validation failures arrive as field errors, with no second argument.
   * Anything else arrives as an empty error map and the thrown value — there
   * are no field errors to report, but the form still has to say so.
   */
  onError?: (errors: Record<string, string[]>, error?: unknown) => void;
  onSubmit?: (formData: FormData) => void | false;
  children: ReactNode | ((form: FormRenderProps<T>) => ReactNode);
}

/**
 * What an action built with createActionClient answers with.
 *
 * Recognised rather than thrown, because React serialises a rejected server
 * action opaquely: production strips the message and the fields it named are
 * gone. A returned object crosses intact, so a form reads it.
 */
function resultOf(value: unknown): { errors?: Record<string, string[]>; serverError?: string } | null {
  if (typeof value !== 'object' || value === null) return null

  const result = value as { validationErrors?: Record<string, string[]>; serverError?: string }

  if (result.validationErrors) return { errors: result.validationErrors }
  if (result.serverError) return { serverError: result.serverError }

  return null
}

const FormStatusContext = createContext<FormRenderProps>({
  pending: false,
  data: {},
  errors: {},
  error: () => undefined,
  clearErrors: () => {},
  reset: () => {},
  succeeded: false,
  recentlySucceeded: false,
  // Outside a Form there is nothing holding a value, so a binding that reported
  // one would be lying. Name only, which is the part that is still true.
  field: (name: string) => ({ name, value: "", onChange: () => {}, onBlur: () => {} }),
});

export function useFormStatus<T extends Record<string, unknown> = Record<string, unknown>>(): FormRenderProps<T> {
  return useContext(FormStatusContext) as FormRenderProps<T>;
}

/**
 * The pieces of a field name: `items[0].name` is items, 0, name.
 *
 * Both spellings, because both are in use and a form should not care which one
 * a person reached for: `items[0].name` and `items[0][name]` are the same
 * field. A trailing `[]` is a piece of its own — see below.
 */
function pathOf(name: string): string[] {
  return name
    .replace(/\[(\w*)\]/g, ".$1")
    .split(".")
    .filter((piece, index, all) => piece !== "" || index === all.length - 1);
}

/** Whether a piece names an array index rather than a property. */
const isIndex = (piece: string): boolean => /^\d+$/.test(piece);

/**
 * Put one value at one path, making the containers it passes through.
 *
 * Whether a container is an array or an object is decided by the NEXT piece, so
 * `items[0].name` makes an array holding an object without being told which is
 * which.
 */
function place(root: Record<string, unknown>, path: string[], value: unknown): void {
  let node: Record<string, unknown> | unknown[] = root;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const container = node as Record<string, unknown>;

    if (container[key] === undefined || typeof container[key] !== "object") {
      // An index makes an array, and so does the empty piece a trailing `[]`
      // leaves — `tags[]` has to reach an array to be pushed into, and building
      // an object there is how this first went wrong.
      const next = path[i + 1];

      container[key] = isIndex(next) || next === "" ? [] : {};
    }

    node = container[key] as Record<string, unknown> | unknown[];
  }

  const last = path[path.length - 1];

  // The empty piece a trailing `[]` leaves: push rather than assign, so
  // `tags[]` twice is two entries rather than one overwriting the other.
  if (last === "") (node as unknown[]).push(value);
  else (node as Record<string, unknown>)[last] = value;
}

/**
 * A FormData as the object a schema expects.
 *
 * Four things beyond copying entries across, and each of them was a bug or a
 * gap someone would meet on their first non-trivial form:
 *
 * A repeated name is an array. Three checkboxes sharing a name, a multiple
 * select, a list of tags — this used to keep the LAST one and drop the rest
 * silently, so a schema validated an object the person had not submitted.
 *
 * A name ending in `[]` is always an array, even with one value selected.
 * Otherwise a list of checkboxes is a string when one is ticked and an array
 * when two are, and no schema can describe both. It is also what `useForm`
 * writes when it serialises an array, so the two round-trip.
 *
 * Nested names nest. `address.city` and `items[0].name` build the object they
 * describe, which is the shape the schema was written against — and the shape
 * whose validation errors come back keyed the same way, because Standard
 * Schema issue paths are joined with dots too.
 *
 * Files are kept. They were dropped for being non-strings, which meant a schema
 * checking an upload was handed undefined and refused a file that was there.
 */
function formDataToObject<T extends Record<string, unknown>>(formData: FormData): T {
  const obj: Record<string, unknown> = {};

  for (const name of new Set(formData.keys())) {
    const all = formData.getAll(name);
    const path = pathOf(name);

    // A plain name used more than once is the array case, and it has no
    // brackets to say so — `tags` twice is `['a', 'b']`.
    if (path.length === 1 && path[0] !== "" && all.length > 1) {
      obj[path[0]] = all;
      continue;
    }

    for (const value of all) place(obj, path, value);
  }

  return obj as T;
}

/**
 * Also exported by name, and re-exported below, because both spellings are in
 * use: `import Form from` and `import { Form } from`.
 */
export default function Form<T extends Record<string, unknown> = Record<string, unknown>>({
  action,
  method: methodProp,
  defaultValues,
  prefetch = "hover",
  cacheFor,
  replace = false,
  preserveScroll = false,
  resetOnSuccess = true,
  schema,
  transform,
  optimistic,
  onSuccess,
  onError,
  onSubmit,
  children,
  ...rest
}: FormProps<T>) {
  const isGetForm = typeof action === "string";
  const method = methodProp ?? (isGetForm ? "get" : "post");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [succeeded, setSucceeded] = useState(false);
  const [recentlySucceeded, setRecentlySucceeded] = useState(false);
  const recentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cleared on unmount: a timer that fires into a component that has gone is
  // the warning nobody reads and the leak nobody finds.
  useEffect(() => () => clearTimeout(recentTimer.current), []);

  // Only the fields someone bound with `field()`. Everything else is the DOM's.
  const [bound, setBound] = useState<Record<string, unknown>>(
    () => ({ ...(defaultValues as Record<string, unknown> | undefined) }),
  );
  const [currentData, setCurrentData] = useState<T>({} as T);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const error = useCallback(
    (field: keyof T & string): string | undefined => errors[field]?.[0],
    [errors]
  );

  const clearErrors = useCallback(
    (...fields: (keyof T & string)[]) => {
      if (fields.length === 0) {
        setErrors({});
      } else {
        setErrors((prev) => {
          const next = { ...prev };
          for (const f of fields) {
            delete next[f];
          }
          return next;
        });
      }
    },
    []
  );

  const resetForm = useCallback(() => {
    formRef.current?.reset();
    setErrors({});
    setCurrentData({} as T);
  }, []);

  useEffect(() => {
    if (isGetForm && prefetch === "mount") {
      const fn = (window as any).__rsc_prefetch;
      fn?.(action, cacheFor);
    }
  }, [isGetForm, prefetch, action, cacheFor]);

  const doPrefetch = useCallback(() => {
    if (!isGetForm) return;
    const fn = (window as any).__rsc_prefetch;
    fn?.(action as string, cacheFor);
  }, [isGetForm, action, cacheFor]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const data = formDataToObject<T>(formData);
      setCurrentData(data);

      if (onSubmit?.(formData) === false) {
        return;
      }

      if (isGetForm && method === "get") {
        const url = new URL(action as string, window.location.origin);
        for (const [key, value] of formData.entries()) {
          if (typeof value === "string" && value !== "") {
            url.searchParams.set(key, value);
          }
        }

        const path = url.pathname + url.search;
        const shell = action as string;
        const nav = (window as any).__rsc_navigate;
        const prefetched = (window as any).__rsc_is_prefetched;

        // The route without its query is that route's shell: the layout, the
        // chrome, and whatever it renders with nothing to show yet. Prefetching
        // on hover put it in the cache, so going there first costs no request
        // and puts the page on screen while the real query is still running.
        //
        // The query itself is never prefetched. It is the expensive half, and
        // hovering a search button is not a reason to run someone's search.
        if (path !== shell && prefetched?.(shell)) {
          // Awaited rather than raced: navigate() aborts whatever is in flight,
          // so starting the real one first would cancel the shell before it
          // could render. It is a cache hit, so this is a render, not a wait.
          Promise.resolve(nav?.(shell, { replace, preserveScroll })).then(() =>
            // Replaces, so the shell does not become a back-button stop of its
            // own — the pair leaves exactly one entry behind.
            nav?.(path, { replace: true, preserveScroll })
          );

          return;
        }

        nav?.(path, { replace, preserveScroll });
        return;
      }

      const serverAction = action as (formData: FormData) => Promise<unknown>;

      // Apply transform — rebuild FormData from transformed values
      if (transform) {
        const transformed = transform(data);
        for (const key of [...formData.keys()]) {
          formData.delete(key);
        }
        for (const [key, val] of Object.entries(transformed)) {
          if (val === null || val === undefined) continue;
          if (val instanceof File) {
            formData.append(key, val);
          } else if (typeof val === "boolean") {
            formData.append(key, val ? "1" : "0");
          } else if (Array.isArray(val)) {
            for (const item of val) {
              formData.append(`${key}[]`, String(item));
            }
          } else {
            formData.append(key, String(val));
          }
        }
      }

      setErrors({});

      // Before the transition, so a failure neither runs the optimistic
      // update nor leaves the form looking like it is submitting.
      const invalid = await validateWith(schema, data);

      if (invalid) {
        setErrors(invalid);
        onError?.(invalid);

        return;
      }

      startTransition(async () => {
        try {
          // Call optimistic updater inside the transition so React's
          // useOptimistic picks it up and auto-reverts on settle.
          optimistic?.(data);

          const result = await serverAction(formData);
          const refused = resultOf(result);

          if (refused) {
            if (refused.errors) {
              setErrors(refused.errors);
              onError?.(refused.errors);
            } else {
              onError?.({}, new Error(refused.serverError));
            }

            return;
          }

          if (resetOnSuccess) {
            formRef.current?.reset();
            setCurrentData({} as T);
          }

          setErrors({});
          setSucceeded(true);
          setRecentlySucceeded(true);

          clearTimeout(recentTimer.current);
          recentTimer.current = setTimeout(() => setRecentlySucceeded(false), 2_000);

          onSuccess?.(result);
        } catch (err) {
          if (err instanceof ServerValidationError) {
            setErrors(err.errors);
            onError?.(err.errors);
          } else if (err instanceof ServerDumpError) {
            // Dump overlay is already shown — silently swallow
          } else if (onError) {
            // Not rethrown. A rejected action never settles, and until it
            // settles React keeps the optimistic update on screen — so an
            // unexpected failure left the row showing as though the write had
            // worked. Settling is what takes it back.
            onError({}, err);
          } else {
            // Nothing is handling it, and swallowing here would lose it
            // entirely — the reason this used to rethrow.
            console.error('[rsc-kit] form submit failed', err);
          }
        }
      });
    },
    [action, isGetForm, method, replace, preserveScroll, resetOnSuccess, schema, transform, optimistic, onSubmit, onSuccess, onError]
  );

  const field = useCallback(
    (name: keyof T & string): FieldBinding => ({
      name,
      value: String(bound[name] ?? (defaultValues as Record<string, unknown> | undefined)?.[name] ?? ""),
      // Either shape: a DOM event, or the value itself. A native input passes
      // the event; a Radix select or a rich editor passes what was chosen, and
      // a binder that only understood one of them would work on half the
      // controls anyone actually uses.
      onChange: (next: unknown) => {
        const value =
          typeof next === "object" && next !== null && "target" in next
            ? (next as { target: { value: string } }).target.value
            : next;

        setBound((prev) => ({ ...prev, [name]: value }));
      },
      onBlur: () => {},
    }),
    [bound, defaultValues],
  );

  const formStatus: FormRenderProps<T> = {
    pending: isPending,
    data: currentData,
    succeeded,
    recentlySucceeded,
    field,
    errors,
    error,
    clearErrors,
    reset: resetForm,
  };

  return (
    <FormStatusContext.Provider value={formStatus as FormRenderProps}>
      <form
        ref={formRef}
        // On the element as well as in the handler, which is what makes this
        // work before hydration. React emits a form a browser can submit on its
        // own for a server action, and an ordinary action/method pair for a
        // url — so a submit that happens before the javascript arrives still
        // reaches the server.
        //
        // The two do not fight: handleSubmit calls preventDefault() first, and
        // React does not run a form action when the submit event was cancelled.
        // So the enhanced path wins whenever there is one, and the native path
        // is what is left when there is not.
        action={action as never}
        // Only for a url. React sets the method itself for a server action, and
        // passing one alongside is what it warns about.
        method={isGetForm ? method : undefined}
        onSubmit={handleSubmit}
        onMouseEnter={prefetch === "hover" ? doPrefetch : undefined}
        data-pending={isPending ? "" : undefined}
        {...rest}
      >
        {typeof children === "function" ? children(formStatus) : children}
      </form>
    </FormStatusContext.Provider>
  );
}

// Also by name, because both spellings are in use: `import Form` and
// `import { Form }`. This was a re-export of "./Form" — from inside Form.tsx,
// so the module named itself. It survived on the bundler tolerating a circular
// self-reference, left over from when a separate barrel re-exported a
// FormComponent.tsx that a case-insensitive filesystem would not let be called
// Form.ts. There is one file now, and it can just export what it declares.
export { Form };
export { useForm } from "./useForm";
