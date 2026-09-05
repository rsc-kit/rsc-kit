"use client";

import { useState, useRef, useCallback, useTransition } from "react";
import { ServerValidationError, ServerDumpError } from "./errors";
import { validateWith } from "./standardSchema";
import type { StandardSchemaV1 } from "./standardSchema";

type SetDataFn<T> = {
  <K extends keyof T>(field: K, value: T[K]): void;
  (values: Partial<T>): void;
};

export interface UseFormReturn<T extends Record<string, unknown>> {
  data: T;
  setData: SetDataFn<T>;
  errors: Partial<Record<keyof T & string, string[]>>;
  error: (field: keyof T & string) => string | undefined;
  hasErrors: boolean;
  pending: boolean;
  processing: boolean;
  wasSuccessful: boolean;
  recentlySuccessful: boolean;
  clearErrors: (...fields: (keyof T & string)[]) => void;
  reset: (...fields: (keyof T)[]) => void;
  setDefaults: (values?: Partial<T>) => void;
  transform: (fn: (data: T) => Record<string, unknown>) => void;
  submit: (action: (formData: FormData) => Promise<unknown>, optimistic?: () => void) => Promise<void>;
}

/**
 * Serialize form state into FormData for a server action.
 *
 * Exported for testing: this is the contract between useForm and the action —
 * booleans become "1"/"0" so PHP sees something truthy, arrays repeat under
 * `key[]`, Files pass through untouched for native uploads, and null/undefined
 * are dropped rather than sent as the string "null".
 */
export function buildFormData(data: Record<string, unknown>): FormData {
  const formData = new FormData();

  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) {
      continue;
    }
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

  return formData;
}

export function useForm<T extends Record<string, unknown>>(
  initialValues: T,
  options: {
    /**
     * Check the fields before submitting, with any Standard Schema — Zod,
     * Valibot, ArkType.
     *
     * A failure fills `errors` and the action is never called. A courtesy, not
     * a control: the action is reachable without this form, so the server
     * still has to check.
     */
    schema?: StandardSchemaV1
  } = {},
): UseFormReturn<T> {
  const [data, setDataState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [wasSuccessful, setWasSuccessful] = useState(false);
  const [recentlySuccessful, setRecentlySuccessful] = useState(false);
  const [isPending, startTransition] = useTransition();

  const defaultsRef = useRef<T>({ ...initialValues });
  const transformRef = useRef<((data: T) => Record<string, unknown>) | null>(null);
  const recentTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setData: SetDataFn<T> = useCallback(
    (fieldOrValues: keyof T | Partial<T>, value?: unknown) => {
      if (typeof fieldOrValues === "object") {
        setDataState((prev) => ({ ...prev, ...fieldOrValues }));
      } else {
        setDataState((prev) => ({ ...prev, [fieldOrValues]: value as T[keyof T] }));
      }
    },
    []
  );

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

  const reset = useCallback(
    (...fields: (keyof T)[]) => {
      if (fields.length === 0) {
        setDataState({ ...defaultsRef.current });
      } else {
        setDataState((prev) => {
          const next = { ...prev };
          for (const f of fields) {
            next[f] = defaultsRef.current[f];
          }
          return next;
        });
      }
      clearErrors();
    },
    [clearErrors]
  );

  const setDefaults = useCallback(
    (values?: Partial<T>) => {
      if (values) {
        defaultsRef.current = { ...defaultsRef.current, ...values };
      } else {
        defaultsRef.current = { ...data };
      }
    },
    [data, options.schema]
  );

  const transformFn = useCallback(
    (fn: (data: T) => Record<string, unknown>) => {
      transformRef.current = fn;
    },
    []
  );

  const submit = useCallback(
    (action: (formData: FormData) => Promise<unknown>, optimistic?: () => void): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        startTransition(async () => {
          try {
            // Before the optimistic update, so a rejected form never shows the
            // row it was going to add.
            const invalid = await validateWith(options.schema, data);

            if (invalid) {
              setErrors(invalid);
              resolve();

              return;
            }

            // Call optimistic updater inside the transition so React's
            // useOptimistic picks it up and auto-reverts on settle.
            optimistic?.();

            const payload = transformRef.current ? transformRef.current(data) : data;
            const formData = buildFormData(payload);

            setErrors({});

            const result = await action(formData);
            const answer = result as
              | { validationErrors?: Record<string, string[]>; serverError?: string }
              | undefined

            // An action built with createActionClient returns its failures
            // rather than throwing them, because a rejected server action is
            // serialised opaquely and the fields it named would be lost.
            if (answer?.validationErrors) {
              setErrors(answer.validationErrors);
              resolve();

              return;
            }

            if (answer?.serverError) {
              reject(new Error(answer.serverError));

              return;
            }

            setWasSuccessful(true);
            setRecentlySuccessful(true);

            if (recentTimerRef.current) {
              clearTimeout(recentTimerRef.current);
            }
            recentTimerRef.current = setTimeout(() => setRecentlySuccessful(false), 2000);

            resolve();
          } catch (err) {
            if (err instanceof ServerValidationError) {
              setErrors(err.errors);
            }
            if (err instanceof ServerDumpError) {
              resolve();
              return;
            }
            reject(err);
          }
        });
      });
    },
    [data]
  );

  return {
    data,
    setData,
    errors: errors as Partial<Record<keyof T & string, string[]>>,
    error,
    hasErrors: Object.keys(errors).length > 0,
    pending: isPending,
    processing: isPending,
    wasSuccessful,
    recentlySuccessful,
    clearErrors,
    reset,
    setDefaults,
    transform: transformFn,
    submit,
  };
}
