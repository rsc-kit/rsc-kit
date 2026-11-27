// <Form>'s checks against the server: on blur when a field changed, and
// whenever validate() is called - a wizard's step, a field checked as it is
// typed. What the server is sent is the form as a submit would send it, with
// the fields to check marked in it; what comes back lands on those fields.

import { registerDom } from "./dom";

registerDom();

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "bun:test";
import Form from "../../src/js/Form";
import { CHECK_FIELD } from "../../src/js/checkField";
import { ServerValidationError } from "../../src/js/errors";
import { setQueryCodec } from "../../src/js/queryClient";

// Flight encodes a server reference and refuses a function of the browser's
// own; this stands in for it.
const references = new WeakSet<object>();

setQueryCodec({
  deserialize: async () => null,
  encode: async (args) => {
    if (typeof args[0] === "function" && !references.has(args[0])) throw new Error("Client Functions cannot be passed");

    return "[]";
  },
  asAction: async () => null,
});

type Verdict = { errors?: Record<string, string[]>; unsupported?: true };

/** A server action that answers checks with `verdict` and records every call. */
function serverAction(verdict: (fields: string[]) => Verdict) {
  const calls: { check: string[] | null; data: Record<string, FormDataEntryValue> }[] = [];
  const action = async (data: FormData) => {
    const mark = data.get(CHECK_FIELD);
    const check = mark === null ? null : (JSON.parse(String(mark)) as string[]);
    const entries = Object.fromEntries([...data.entries()].filter(([k]) => k !== CHECK_FIELD));

    calls.push({ check, data: entries });

    return check ? { __rscChecked: verdict(check) } : {};
  };

  references.add(action);

  return { action, calls };
}

const mount = async (node: React.ReactNode) => {
  const host = document.createElement("div");
  document.body.append(host);

  await act(async () => {
    createRoot(host).render(node);
  });

  return host;
};

const FocusEvent = () => (window as never as { FocusEvent: typeof globalThis.FocusEvent }).FocusEvent;

/** Leave `input` for `next`, inside the form - checked at once. */
const leave = (input: HTMLInputElement, next: HTMLElement) =>
  act(async () => {
    input.dispatchEvent(new (FocusEvent())("focusout", { bubbles: true, relatedTarget: next }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    input.value = value;
    input.dispatchEvent(new (window as never as { Event: typeof Event }).Event("input", { bubbles: true }));
  });

describe("validate()", () => {
  test("asks about the fields named, and shows errors on those alone", async () => {
    const { action, calls } = serverAction(() => ({ errors: { email: ["Already subscribed."] } }));
    let form: any;

    await mount(
      <Form action={action}>
        {(f) => {
          form = f;

          return (
            <>
              <input name="email" defaultValue="a@b.co" />
              <input name="plan" defaultValue="" />
            </>
          );
        }}
      </Form>,
    );

    let passed: boolean | undefined;

    await act(async () => {
      passed = await form.validate("email");
    });

    expect(passed).toBe(false);
    expect(calls).toEqual([{ check: ["email"], data: { email: "a@b.co", plan: "" } }]);
    expect(form.error("email")).toBe("Already subscribed.");
    expect(form.error("plan")).toBeUndefined();
  });

  test("passes, and says which fields are valid", async () => {
    const { action } = serverAction(() => ({}));
    let form: any;

    await mount(
      <Form action={action}>
        {(f) => {
          form = f;

          return <input name="name" defaultValue="Ada" />;
        }}
      </Form>,
    );

    expect(form.valid("name")).toBe(false);

    let passed: boolean | undefined;

    await act(async () => {
      passed = await form.validate("name");
    });

    expect(passed).toBe(true);
    expect(form.valid("name")).toBe(true);
  });

  // A mistake the browser can see costs no round trip.
  test("a field the schema rejects is not sent", async () => {
    const { action, calls } = serverAction(() => ({}));
    const schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: { name?: string }) =>
          (value.name ?? "").length < 2 ? { issues: [{ message: "too short", path: ["name"] }] } : { value },
      },
    };
    let form: any;

    await mount(
      <Form action={action} schema={schema as never}>
        {(f) => {
          form = f;

          return <input name="name" defaultValue="A" />;
        }}
      </Form>,
    );

    await act(async () => {
      await form.validate("name");
    });

    expect(calls).toEqual([]);
    expect(form.error("name")).toBe("too short");
  });

  test("a file goes only when its field is named", async () => {
    const { action, calls } = serverAction(() => ({}));
    let form: any;

    const host = await mount(
      <Form action={action}>
        {(f) => {
          form = f;

          return (
            <>
              <input name="title" defaultValue="Report" />
              <input name="attachment" type="file" />
            </>
          );
        }}
      </Form>,
    );

    const file = host.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(file, "files", { value: [new File(["x".repeat(10)], "a.pdf")] });

    await act(async () => {
      await form.validate("title");
    });

    expect(calls[0]!.data.attachment).toBeUndefined();

    await act(async () => {
      await form.validate("attachment");
    });

    expect(calls[1]!.data.attachment).toBeInstanceOf(File);
  });

  test("a function of the browser's own is never called to check", async () => {
    let ran = 0;
    const local = async () => {
      ran++;

      return {};
    };
    let form: any;

    await mount(
      <Form action={local}>
        {(f) => {
          form = f;

          return <input name="name" defaultValue="Ada" />;
        }}
      </Form>,
    );

    let passed: boolean | undefined;

    await act(async () => {
      passed = await form.validate("name");
    });

    expect(passed).toBe(true);
    expect(ran).toBe(0);
  });
});

describe("leaving a field", () => {
  test("asks the server once the field has changed, and not before", async () => {
    const { action, calls } = serverAction(() => ({ errors: { email: ["Already subscribed."] } }));
    let form: any;

    const host = await mount(
      <Form action={action}>
        {(f) => {
          form = f;

          return (
            <>
              <input name="email" defaultValue="" />
              <input name="name" defaultValue="" />
            </>
          );
        }}
      </Form>,
    );

    const [email, name] = [...host.querySelectorAll("input")] as HTMLInputElement[];

    // Tabbing through sends nothing.
    await leave(email!, name!);
    expect(calls).toEqual([]);

    await type(email!, "a@b.co");
    await leave(email!, name!);

    expect(calls.map((c) => c.check)).toEqual([["email"]]);
    expect(form.error("email")).toBe("Already subscribed.");

    // Passing through again keeps the answer and asks nobody.
    await leave(email!, name!);

    expect(calls).toHaveLength(1);
    expect(form.error("email")).toBe("Already subscribed.");
  });

  test("stops asking an action that cannot be checked", async () => {
    const { action, calls } = serverAction(() => ({ unsupported: true }));

    const host = await mount(
      <Form action={action}>
        {() => (
          <>
            <input name="a" defaultValue="" />
            <input name="b" defaultValue="" />
          </>
        )}
      </Form>,
    );

    const [a, b] = [...host.querySelectorAll("input")] as HTMLInputElement[];

    await type(a!, "1");
    await leave(a!, b!);
    await type(b!, "2");
    await leave(b!, a!);

    expect(calls).toHaveLength(1);
  });

  test("leaving a field for the submit button asks nothing: the submit is the verdict", async () => {
    // Typed the confirmation, clicked Save: the check and the submit went
    // together, both through the action's middleware. Behind throttle:6,1 the
    // check was a hit of its own, and on SQLite the two collided - "database
    // is locked" on the starter kit's password form.
    const { action, calls } = serverAction(() => ({ errors: { name: ["Taken."] } }));

    const host = await mount(
      <Form action={action}>
        {() => (
          <>
            <input name="name" defaultValue="" />
            <button type="button">Generate</button>
            <button>Save</button>
            <input type="submit" value="Save and add another" />
          </>
        )}
      </Form>,
    );

    const name = host.querySelector("input[name=name]") as HTMLInputElement;
    const [generate, save] = [...host.querySelectorAll("button")] as HTMLButtonElement[];
    const another = host.querySelector("input[type=submit]") as HTMLInputElement;

    await type(name, "Ada");
    await leave(name, save!);
    await leave(name, another);

    expect(calls).toEqual([]);

    // A button that is not a submit is somewhere else in the form.
    await leave(name, generate!);

    expect(calls.map((c) => c.check)).toEqual([["name"]]);
  });

  test("a field the submit disabled is not checked over the submit's answer", async () => {
    // The starter kit's 2FA code: disabled while the submit is pending, so it
    // lost focus to nothing - "left the form" - and emptied when the code was
    // refused. The check that blur scheduled ran after the refusal, found the
    // empty field unchanged, and took "The code was invalid" off the screen
    // 300ms after it appeared.
    const calls: string[] = [];
    const action = async (data: FormData) => {
      if (data.get(CHECK_FIELD) !== null) {
        calls.push("check");

        return { __rscChecked: {} };
      }

      calls.push("submit");
      await answered;
      throw new ServerValidationError("Invalid.", { code: ["The code was invalid."] });
    };
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));

    references.add(action);

    let form: any;
    let clear: () => void = () => {};

    function Code() {
      const [code, setCode] = useState("123456");

      clear = () => setCode("");

      return (
        <Form action={action} onError={() => clear()}>
          {(f) => {
            form = f;

            return <input name="code" value={code} onChange={(e) => setCode(e.target.value)} disabled={f.pending} />;
          }}
        </Form>
      );
    }

    const host = await mount(<Code />);
    const input = host.querySelector("input") as HTMLInputElement;
    const formEl = host.querySelector("form")!;

    await act(async () => {
      formEl.dispatchEvent(new (window as never as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }));
    });

    // Disabled for the pending submit, the field loses focus to nothing.
    expect(input.disabled).toBe(true);

    await act(async () => {
      input.dispatchEvent(new (FocusEvent())("focusout", { bubbles: true, relatedTarget: null }));
    });

    // Refused well inside the blur's wait, and the field emptied.
    await act(async () => {
      answer();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(form.error("code")).toBe("The code was invalid.");
    expect(input.value).toBe("");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(calls).toEqual(["submit"]);
    expect(form.error("code")).toBe("The code was invalid.");
  });

  test("a check from before a submit does not speak over its answer", async () => {
    // Left the field and pressed Save at once: on iOS a tap does not focus
    // the button, so the blur reads as leaving the form and waits. The
    // submit is refused inside that wait, and the check it would have run -
    // or one already on its way - must not take the refusal back.
    const calls: string[] = [];
    let release: () => void = () => {};
    const slowCheck = new Promise<void>((resolve) => (release = resolve));
    const action = async (data: FormData) => {
      if (data.get(CHECK_FIELD) !== null) {
        calls.push("check");
        await slowCheck;

        return { __rscChecked: {} };
      }

      calls.push("submit");
      throw new ServerValidationError("Invalid.", { email: ["Taken."], name: ["Required."] });
    };

    references.add(action);

    let form: any;

    const host = await mount(
      <Form action={action}>
        {(f) => {
          form = f;

          return (
            <>
              <input name="email" defaultValue="" />
              <input name="name" defaultValue="" />
            </>
          );
        }}
      </Form>,
    );

    const [email, name] = [...host.querySelectorAll("input")] as HTMLInputElement[];
    const submit = () =>
      act(async () => {
        host
          .querySelector("form")!
          .dispatchEvent(new (window as never as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

    // A check already asked, still out when the submit is refused.
    await type(email!, "a@b.co");
    await leave(email!, name!);
    expect(calls).toEqual(["check"]);

    // And a blur that left the form, waiting to ask.
    await type(name!, "Ada");
    await act(async () => {
      name!.dispatchEvent(new (FocusEvent())("focusout", { bubbles: true, relatedTarget: null }));
    });

    await submit();
    expect(form.error("email")).toBe("Taken.");

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(calls).toEqual(["check", "submit"]);
    expect(form.error("email")).toBe("Taken.");
    expect(form.error("name")).toBe("Required.");
  });

  test("a submit is still a submit", async () => {
    const { action, calls } = serverAction(() => ({}));

    const host = await mount(
      <Form action={action}>
        {() => <input name="name" defaultValue="Ada" />}
      </Form>,
    );

    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new (window as never as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(calls).toEqual([{ check: null, data: { name: "Ada" } }]);
  });
});
