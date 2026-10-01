// Calling an action from a button: a transition around the call, the last
// result, and callbacks that say which way it went.

import { registerDom } from "./dom";

registerDom();

import { act, useOptimistic, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "bun:test";
import { useAction, type UseActionOptions } from "../../src/js/useAction";
import type { ActionResult } from "../../src/action";

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
