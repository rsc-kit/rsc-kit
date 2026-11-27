// Calling an action from a button: a transition around the call, the last
// result, and callbacks that say which way it went.

import { registerDom } from "./dom";

registerDom();

import { act, useOptimistic, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "bun:test";
import { useAction, type UseActionOptions } from "../../src/js/useAction";
import type { ActionResult } from "../../src/action";
import { ServerValidationError, type Answer, type Redirected } from "../../src/js/errors";

type Action = (input?: unknown) => Promise<ActionResult<string>>;

/** Mount a component that hands its hook back, and record the callbacks. */
async function harness(action: Action, extra: UseActionOptions<Action> = {}) {
  const calls: string[] = [];
  const seen: { hook: ReturnType<typeof useAction<Action>> | null } = { hook: null };

  function Harness() {
    seen.hook = useAction(action, {
      onSuccess: (data) => calls.push(`success:${data}`),
      onError: (message) => calls.push(`error:${message}`),
      onSettled: () => calls.push("settled"),
      ...extra,
    });

    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);

  await act(async () => {
    createRoot(host).render(<Harness />);
  });

  return { calls, hook: () => seen.hook!, host };
}

describe("the outcome", () => {
  test("data is a success", async () => {
    const { calls, hook } = await harness(async () => ({ data: "saved" }));

    await act(async () => hook().execute());

    expect(calls).toEqual(["success:saved", "settled"]);
    expect(hook().status).toBe("hasSucceeded");
    expect(hook().result).toEqual({ data: "saved" });
  });

  test("a server error is an error, with its message", async () => {
    const { calls, hook } = await harness(async () => ({ serverError: "No room left." }));

    await act(async () => hook().execute());

    expect(calls).toEqual(["error:No room left.", "settled"]);
    expect(hook().status).toBe("hasErrored");
  });

  test("validation errors are an error, with the first message, for a button with no field", async () => {
    const { calls, hook } = await harness(async () => ({
      validationErrors: { email: ["Enter an email."], name: ["Too short."] },
    }));

    await act(async () => hook().execute());

    expect(calls).toEqual(["error:Enter an email.", "settled"]);
  });

  test("a throw on the way is an error too, never a rejection", async () => {
    const { calls, hook } = await harness(async () => {
      throw new Error("Failed to fetch");
    });

    let answered: ActionResult<string> | undefined;

    await act(async () => {
      answered = await hook().executeAsync();
    });

    expect(answered).toEqual({ serverError: "Failed to fetch" });
    expect(calls).toEqual(["error:Failed to fetch", "settled"]);
  });

  test("a redirect settles nothing: the page is leaving", async () => {
    const { calls, hook } = await harness(async () => ({ redirected: "/dashboard" }));

    await act(async () => hook().execute());

    expect(calls).toEqual([]);
    expect(hook().status).toBe("idle");
    expect(hook().result).toEqual({});
  });

  test("a redirect back to this page is a success: back() after a save", async () => {
    // Laravel answers a save with back(), Fortify answers enabling two-factor
    // so: the page re-renders and the button that asked is still on it.
    const { calls, hook } = await harness(async () => ({ redirected: window.location.href }));

    await act(async () => hook().execute());

    expect(calls).toEqual(["success:undefined", "settled"]);
    expect(hook().status).toBe("hasSucceeded");
  });

  test("reset forgets the last result", async () => {
    const { hook } = await harness(async () => ({ data: "saved" }));

    await act(async () => hook().execute());
    await act(async () => hook().reset());

    expect(hook().status).toBe("idle");
    expect(hook().result).toEqual({});
  });
});

describe("while it runs", () => {
  test("isPending is true, and the status says executing", async () => {
    let finish: (value: ActionResult<string>) => void = () => {};
    const { hook } = await harness(() => new Promise((resolve) => (finish = resolve)));

    await act(async () => hook().execute());

    expect(hook().isPending).toBe(true);
    expect(hook().status).toBe("executing");

    await act(async () => finish({ data: "done" }));

    expect(hook().isPending).toBe(false);
    expect(hook().status).toBe("hasSucceeded");
  });

  test("execute keeps its identity across renders, and still calls the newest callback", async () => {
    const calls: string[] = [];
    const executes = new Set<unknown>();
    let bump: () => void = () => {};

    function Harness() {
      const [round, setRound] = useState(0);
      bump = () => setRound((r) => r + 1);

      const { execute } = useAction(async () => ({ data: "x" }), {
        onSuccess: () => calls.push(`round ${round}`),
      });

      executes.add(execute);
      run = execute;

      return null;
    }

    let run: () => void = () => {};
    const host = document.createElement("div");
    document.body.append(host);

    await act(async () => createRoot(host).render(<Harness />));
    await act(async () => bump());
    await act(async () => bump());
    await act(async () => run());

    expect(executes.size).toBe(1);
    expect(calls).toEqual(["round 2"]);
  });
});

describe("optimistic", () => {
  test("shows at once, and is taken back when the action fails", async () => {
    let finish: (value: ActionResult<string>) => void = () => {};
    let shown: string[] = [];
    let run: (name: string) => void = () => {};

    function List() {
      const [items, add] = useOptimistic(["a"], (state, name: string) => [...state, name]);
      const { execute } = useAction(
        (_name: string) => new Promise<ActionResult<string>>((resolve) => (finish = resolve)),
        { optimistic: (name) => add(name) },
      );

      shown = items;
      run = execute;

      return null;
    }

    const host = document.createElement("div");
    document.body.append(host);

    await act(async () => createRoot(host).render(<List />));
    await act(async () => run("b"));

    expect(shown).toEqual(["a", "b"]);

    await act(async () => finish({ serverError: "No." }));

    expect(shown).toEqual(["a"]);
  });
});

/**
 * A backend stub is a plain "use server" function: it resolves with what the
 * backend returned and rejects when the call was refused. The transport claims
 * the answer synchronously, as callServer does, and says plain when the
 * server's answer carried X-RSC-Plain.
 */
function stub<T>(answer: () => Promise<T>): () => Promise<T | Redirected> {
  return () => {
    const answered = (globalThis as { __rscAnswer?: Answer | null }).__rscAnswer;

    return answer().then((value) => {
      if (answered) answered.plain = true;

      return value;
    });
  };
}

describe("a backend stub", () => {
  test("its value is the data, even when it looks like a result", async () => {
    const seen: unknown[] = [];
    const action = stub(async () => ({ data: [1, 2], next_cursor: null }));
    let hook: ReturnType<typeof useAction<typeof action>> | null = null;

    function Harness() {
      hook = useAction(action, { onSuccess: (page) => seen.push(page) });

      return null;
    }

    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<Harness />));

    await act(async () => hook!.execute());

    expect(seen).toEqual([{ data: [1, 2], next_cursor: null }]);
    expect(hook!.status).toBe("hasSucceeded");
  });

  test("a refusal is an error, with the fields", async () => {
    const calls: string[] = [];
    const action = stub(async (): Promise<null> => {
      throw new ServerValidationError("Validation failed", { code: ["The code is invalid."] });
    });
    let hook: ReturnType<typeof useAction<typeof action>> | null = null;

    function Harness() {
      hook = useAction(action, { onError: (message) => calls.push(message) });

      return null;
    }

    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<Harness />));

    await act(async () => hook!.execute());

    expect(calls).toEqual(["The code is invalid."]);
    expect(hook!.result.validationErrors).toEqual({ code: ["The code is invalid."] });
  });

  test("is called with its own parameters as well as a form, as the build writes it", async () => {
    // The form overload is last, and Parameters<> reads only that one: a stub
    // with an optional object asked execute() for a FormData.
    async function send(arg1?: Record<string, unknown>): Promise<unknown | Redirected>;
    async function send(form: FormData): Promise<unknown | Redirected>;
    async function send(..._args: unknown[]) {
      return null;
    }

    let hook: ReturnType<typeof useAction<typeof send>> | null = null;

    function Harness() {
      hook = useAction(send);

      return null;
    }

    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<Harness />));

    await act(async () => {
      hook!.execute();
      hook!.execute({ to: "ada" });
      hook!.execute(new FormData());
      // @ts-expect-error - neither signature takes a number
      hook!.execute(5);
    });

    expect(hook!.status).toBe("hasSucceeded");
  });

  test("an action that never reached the transport leaves nothing for the next one", async () => {
    const { hook } = await harness(async () => ({ data: "saved" }));

    await act(async () => hook().execute());

    expect((globalThis as { __rscAnswer?: Answer | null }).__rscAnswer).toBeNull();
  });
});
