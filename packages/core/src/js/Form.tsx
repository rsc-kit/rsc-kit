"use client";

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

type PrefetchStrategy = "hover" | "mount" | "none";

interface FormRenderProps<T extends Record<string, unknown> = Record<string, unknown>> {
  pending: boolean;
  data: T;
  errors: Record<string, string[]>;
  error: (field: keyof T & string) => string | undefined;
  clearErrors: (...fields: (keyof T & string)[]) => void;
  reset: () => void;
}

interface FormProps<T extends Record<string, unknown> = Record<string, unknown>>
  extends Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "method" | "children"> {
  action: string | ((formData: FormData) => Promise<unknown>);
  method?: "get" | "post";
  prefetch?: PrefetchStrategy;
  cacheFor?: number;
  replace?: boolean;
  preserveScroll?: boolean;
  resetOnSuccess?: boolean;
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

const FormStatusContext = createContext<FormRenderProps>({
  pending: false,
  data: {},
  errors: {},
  error: () => undefined,
  clearErrors: () => {},
  reset: () => {},
});

export function useFormStatus<T extends Record<string, unknown> = Record<string, unknown>>(): FormRenderProps<T> {
  return useContext(FormStatusContext) as FormRenderProps<T>;
}

function formDataToObject<T extends Record<string, unknown>>(formData: FormData): T {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      obj[key] = value;
    }
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
  prefetch = "hover",
  cacheFor,
  replace = false,
  preserveScroll = false,
  resetOnSuccess = true,
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
    (e: FormEvent<HTMLFormElement>) => {
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
      startTransition(async () => {
        try {
          // Call optimistic updater inside the transition so React's
          // useOptimistic picks it up and auto-reverts on settle.
          optimistic?.(data);

          const result = await serverAction(formData);

          if (resetOnSuccess) {
            formRef.current?.reset();
            setCurrentData({} as T);
          }

          setErrors({});
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
            console.error('[rsc-router] form submit failed', err);
          }
        }
      });
    },
    [action, isGetForm, method, replace, preserveScroll, resetOnSuccess, transform, optimistic, onSubmit, onSuccess, onError]
  );

  const formStatus: FormRenderProps<T> = {
    pending: isPending,
    data: currentData,
    errors,
    error,
    clearErrors,
    reset: resetForm,
  };

  return (
    <FormStatusContext.Provider value={formStatus as FormRenderProps}>
      <form
        ref={formRef}
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
