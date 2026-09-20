// Binding one field so the component holds its value.
//
// The gap this closes: a control with no native element behind it — a rich
// editor, a Radix select — cannot be read back as FormData, and a value you
// want to show as it is typed cannot be read from an uncontrolled input at all.
// react-hook-form solves both with <Controller>; this is the same four props.

import { registerDom } from "./dom";

registerDom();

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "bun:test";
import Form from "../../src/js/Form";

const mount = async (node: React.ReactNode) => {
  const host = document.createElement("div");
  document.body.append(host);

  await act(async () => {
    createRoot(host).render(node);
  });

  return host;
};

/**
 * A blur that leaves the form is checked only once the form has had a moment
 * to prove it is still there - a dialog closing takes less than this.
 */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

describe("field()", () => {
  test("starts from defaultValues", async () => {
    const host = await mount(
      <Form action={async () => ({})} defaultValues={{ title: "hello" }}>
        {({ field }) => <input {...field("title")} />}
      </Form>,
    );

    expect(host.querySelector("input")!.value).toBe("hello");
  });

  test("and the value is readable as it changes", async () => {
    // The character count in every form design, which an uncontrolled input
    // cannot do — the DOM has the value and React never sees it.
    //
    // Driven through the binding rather than by dispatching a DOM event: what
    // is being tested is that a new value re-renders everything reading it,
    // and React's synthetic event plumbing is happy-dom's problem, not this
    // component's.
    let type: ((next: string) => void) | null = null;

    const host = await mount(
      <Form action={async () => ({})} defaultValues={{ body: "" }}>
        {({ field }) => {
          const bound = field("body");
          type = bound.onChange;

          return (
            <>
              <input {...bound} readOnly />
              <span id="count">{bound.value.length}</span>
            </>
          );
        }}
      </Form>,
    );

    expect(host.querySelector("#count")!.textContent).toBe("0");

    await act(async () => {
      type!("abcd");
    });

    expect(host.querySelector("#count")!.textContent).toBe("4");
    expect(host.querySelector("input")!.value).toBe("abcd");
  });

  test("takes a bare value as well as an event", async () => {
    // A native input passes the event; a Radix select or an editor passes what
    // was chosen. A binder understanding only one works on half the controls
    // people actually use.
    let onChange: ((next: string) => void) | null = null;

    const host = await mount(
      <Form action={async () => ({})} defaultValues={{ kind: "" }}>
        {({ field }) => {
          const bound = field("kind");
          onChange = bound.onChange;

          return <input {...bound} readOnly />;
        }}
      </Form>,
    );

    await act(async () => {
      onChange!("post");
    });

    expect(host.querySelector("input")!.value).toBe("post");
  });

  test("and a bound field still arrives in the submitted data", async () => {
    // It is an ordinary named input, so FormData reads it with everything
    // else. Nothing merges — there is one source of truth.
    let submitted: Record<string, unknown> = {};

    const host = await mount(
      <Form
        action={async (formData: FormData) => {
          submitted = Object.fromEntries(formData.entries());

          return {};
        }}
        defaultValues={{ kind: "post" }}
      >
        {({ field }) => (
          <>
            <input {...field("kind")} readOnly />
            <input name="title" defaultValue="unbound" />
          </>
        )}
      </Form>,
    );

    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(submitted).toEqual({ kind: "post", title: "unbound" });
  });
});

describe("after a successful submit", () => {
  test("says so, and stops saying so", async () => {
    // The "Saved ✓" that fades. State rather than a timer in every form that
    // wants one, because the timer has to be cleared when the component goes
    // away and that is the part people forget.
    let seen: { succeeded: boolean; recentlySucceeded: boolean } = {
      succeeded: false,
      recentlySucceeded: false,
    };

    const host = await mount(
      <Form action={async () => ({})}>
        {({ succeeded, recentlySucceeded }) => {
          seen = { succeeded, recentlySucceeded };

          return <input name="title" defaultValue="hi" />;
        }}
      </Form>,
    );

    expect(seen.succeeded).toBe(false);

    await act(async () => {
      host.querySelector("form")!.dispatchEvent(
        new (window as never as { Event: typeof Event }).Event("submit", {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(seen.succeeded).toBe(true);
    expect(seen.recentlySucceeded).toBe(true);
  });

  test("and a refused submit says neither", async () => {
    let seen = { succeeded: true, recentlySucceeded: true };

    const host = await mount(
      <Form
        action={async () => ({ validationErrors: { title: ["too short"] } })}
      >
        {({ succeeded, recentlySucceeded, errors }) => {
          seen = { succeeded, recentlySucceeded };

          return (
            <>
              <input name="title" defaultValue="x" />
              <span id="err">{errors.title?.[0] ?? ""}</span>
            </>
          );
        }}
      </Form>,
    );

    await act(async () => {
      host.querySelector("form")!.dispatchEvent(
        new (window as never as { Event: typeof Event }).Event("submit", {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(host.querySelector("#err")!.textContent).toBe("too short");
    expect(seen.succeeded).toBe(false);
  });

  test("an action that redirected is not an error for the form to show", async () => {
    // callServer throws ServerRedirectError once it has started the
    // navigation; a form that treated it as a failure toasted "Something
    // went wrong" over a login that had just succeeded.
    const { ServerRedirectError } = await import("../../src/js/errors");
    const reported: unknown[] = [];
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args);

    try {
      const host = await mount(
        <Form
          action={async () => {
            throw new ServerRedirectError("/dashboard");
          }}
          onError={(errors, error) => reported.push([errors, error])}
        >
          {() => <input name="title" defaultValue="x" />}
        </Form>,
      );

      await act(async () => {
        host.querySelector("form")!.dispatchEvent(
          new (window as never as { Event: typeof Event }).Event("submit", {
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    } finally {
      console.error = original;
    }

    expect(reported).toEqual([]);
    expect(logged).toEqual([]);
  });

  test("an action that redirected and resolved is neither a success nor a failure", async () => {
    // callServer performs the redirect and resolves - a plain startTransition
    // caller had no catch for a throw, and the rejection unmounted the root
    // to a white page on every logout. The form asks what happened instead:
    // no "saved", no reset, no onSuccess for a page that is leaving.
    let seen = { succeeded: false };
    const successes: unknown[] = [];

    const host = await mount(
      <Form
        // What callServer resolves with once the navigation is under way.
        action={async () => ({ redirected: "/dashboard" })}
        onSuccess={(result) => successes.push(result)}
      >
        {({ succeeded }) => {
          seen = { succeeded };

          return <input name="title" defaultValue="x" />;
        }}
      </Form>,
    );

    await act(async () => {
      host.querySelector("form")!.dispatchEvent(
        new (window as never as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(successes).toEqual([]);
    expect(seen.succeeded).toBe(false);
  });
});

const schema = {
  "~standard": {
    version: 1 as const,
    vendor: "test",
    validate: (value: unknown) => {
      const { title } = value as { title?: string };

      return title && title.length >= 3
        ? { value }
        : { issues: [{ message: "too short", path: ["title"] }] };
    },
  },
};

describe("fieldState", () => {
  test("nothing is touched or invalid to begin with", async () => {
    let seen = { touched: true, invalid: true, errors: ["x"] };

    await mount(
      <Form action={async () => ({})} schema={schema as never}>
        {({ fieldState }) => {
          seen = fieldState("title");

          return <input name="title" />;
        }}
      </Form>,
    );

    expect(seen).toEqual({ touched: false, invalid: false, errors: [] });
  });

  test("leaving a field checks it, even an uncontrolled one", async () => {
    // The form listens for focusout rather than each field listening for blur,
    // so an ordinary <input name> is covered without being bound.
    let seen = { touched: false, invalid: false, errors: [] as string[] };

    const host = await mount(
      <Form action={async () => ({})} schema={schema as never}>
        {({ fieldState }) => {
          seen = fieldState("title");

          return <input name="title" defaultValue="ab" />;
        }}
      </Form>,
    );

    const input = host.querySelector("input")!;

    await act(async () => {
      input.dispatchEvent(
        new (window as never as { FocusEvent: typeof FocusEvent }).FocusEvent(
          "focusout",
          {
            bubbles: true,
          },
        ),
      );
    });

    await settle();

    expect(seen.touched).toBe(true);
    expect(seen.invalid).toBe(true);
    expect(seen.errors).toEqual(["too short"]);
  });

  test("leaving the form on an empty field does not check it", async () => {
    // Focus going to nothing, or to something outside the form, is a click
    // on the page - a dialog closing, most often. An empty field lit up as
    // the dialog animates out reads as a submit that nobody made.
    let seen = { touched: false, invalid: false, errors: [] as string[] };

    const host = await mount(
      <Form action={async () => ({})} schema={schema as never}>
        {({ fieldState }) => {
          seen = fieldState("title");

          return <input name="title" defaultValue="" />;
        }}
      </Form>,
    );

    const input = host.querySelector("input")!;

    await act(async () => {
      input.dispatchEvent(
        new (window as never as { FocusEvent: typeof FocusEvent }).FocusEvent(
          "focusout",
          {
            bubbles: true,
            relatedTarget: null,
          },
        ),
      );
    });

    expect(seen.touched).toBe(false);
    expect(seen.invalid).toBe(false);
  });

  test("but moving to the next field does, and so does leaving with something typed", async () => {
    let title = { touched: false, invalid: false, errors: [] as string[] };
    let body = { touched: false, invalid: false, errors: [] as string[] };

    const host = await mount(
      <Form action={async () => ({})} schema={schema as never}>
        {({ fieldState }) => {
          title = fieldState("title");
          body = fieldState("body");

          return (
            <>
              <input name="title" defaultValue="" />
              <input name="body" defaultValue="x" />
            </>
          );
        }}
      </Form>,
    );

    const [first, second] = Array.from(host.querySelectorAll("input"));
    const FocusEventCtor = (
      window as never as { FocusEvent: typeof FocusEvent }
    ).FocusEvent;

    // Empty, but focus went to the next field: checked.
    await act(async () => {
      first!.dispatchEvent(
        new FocusEventCtor("focusout", {
          bubbles: true,
          relatedTarget: second,
        }),
      );
    });

    expect(title.touched).toBe(true);

    // Something typed, focus left the form: still checked, once the form
    // has had a moment to prove it is still there.
    await act(async () => {
      second!.dispatchEvent(
        new FocusEventCtor("focusout", { bubbles: true, relatedTarget: null }),
      );
    });

    expect(body.touched).toBe(false);

    await settle();

    expect(body.touched).toBe(true);
  });

  test("leaving with something typed as the form goes away checks nothing", async () => {
    // A dialog closing on an outside click: the field had a value, focus
    // left the form, and by the time the check would run the form is gone.
    // Nobody is there to read an error, so none is made.
    let seen = { touched: false, invalid: false, errors: [] as string[] };

    const host = await mount(
      <Form action={async () => ({})} schema={schema as never}>
        {({ fieldState }) => {
          seen = fieldState("title");

          return <input name="title" defaultValue="ab" />;
        }}
      </Form>,
    );

    const input = host.querySelector("input")!;
    const FocusEventCtor = (
      window as never as { FocusEvent: typeof FocusEvent }
    ).FocusEvent;

    await act(async () => {
      input.dispatchEvent(
        new FocusEventCtor("focusout", { bubbles: true, relatedTarget: null }),
      );
    });

    // The dialog finishes closing: the form leaves the document.
    host.querySelector("form")!.remove();

    await settle();

    expect(seen.touched).toBe(false);
    expect(seen.invalid).toBe(false);
  });

  test("and fixing it clears the error without touching the others", async () => {
    let seen = { touched: false, invalid: false, errors: [] as string[] };

    const host = await mount(
      <Form action={async () => ({})} schema={schema as never}>
        {({ fieldState }) => {
          seen = fieldState("title");

          return <input name="title" defaultValue="abcd" />;
        }}
      </Form>,
    );

    await act(async () => {
      host.querySelector("input")!.dispatchEvent(
        new (window as never as { FocusEvent: typeof FocusEvent }).FocusEvent(
          "focusout",
          {
            bubbles: true,
          },
        ),
      );
    });

    await settle();

    expect(seen.touched).toBe(true);
    expect(seen.invalid).toBe(false);
  });
});

describe("a caller's ref", () => {
  test("is filled, and the form still reads its own element on submit", async () => {
    // React 19 hands a function component its ref as a prop. Spread onto the
    // element after the form's own, it replaced it, and the next FormData
    // read found null. Both handles now point at the one element.
    const theirs = { current: null as HTMLFormElement | null };
    let received: FormData | null = null;

    const host = await mount(
      <Form
        ref={theirs}
        action={async (formData: FormData) => {
          received = formData;

          return {};
        }}
      >
        <input name="title" defaultValue="from the element" />
      </Form>,
    );

    expect(theirs.current).toBe(host.querySelector("form"));

    await act(async () => {
      host.querySelector("form")!.dispatchEvent(
        new (window as never as { Event: typeof Event }).Event("submit", {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(received!.get("title")).toBe("from the element");
  });

  test("a function ref is called with the element too", async () => {
    const seen: (HTMLFormElement | null)[] = [];

    const host = await mount(
      <Form ref={(el) => { seen.push(el); }} action={async () => ({})}>
        <input name="x" />
      </Form>,
    );

    expect(seen[0]).toBe(host.querySelector("form"));
  });
});

describe("dirty", () => {
  const fire = (el: Element, type: string) =>
    act(async () => {
      el.dispatchEvent(new (window as never as { Event: typeof Event }).Event(type, { bubbles: true }));
    });

  test("is false on mount, true once an uncontrolled input differs, false again when it matches", async () => {
    // Every RHF form gated Save/Discard on isDirty. Uncontrolled means only
    // the form can know: a snapshot of its FormData on mount, compared on
    // every input.
    let seen = { dirty: true };

    const host = await mount(
      <Form action={async () => ({})}>
        {({ dirty }) => {
          seen = { dirty };

          return <input name="title" defaultValue="hello" />;
        }}
      </Form>,
    );
    const input = host.querySelector("input")!;

    expect(seen.dirty).toBe(false);

    input.value = "hello there";
    await fire(input, "input");
    expect(seen.dirty).toBe(true);

    input.value = "hello";
    await fire(input, "input");
    expect(seen.dirty).toBe(false);
  });

  test("a checkbox toggled counts, and reset() goes back to clean", async () => {
    let seen = { dirty: true, reset: () => {} };

    const host = await mount(
      <Form action={async () => ({})}>
        {({ dirty, reset }) => {
          seen = { dirty, reset };

          return <input type="checkbox" name="notify" />;
        }}
      </Form>,
    );
    const box = host.querySelector("input")!;

    // A browser fires `input` on a toggled checkbox as well as `change`;
    // React's onChange for a checkbox listens to click, so `input` is the
    // event that reaches the form here.
    box.checked = true;
    await fire(box, "input");
    expect(seen.dirty).toBe(true);

    await act(async () => {
      seen.reset();
      await Promise.resolve();
    });
    expect(box.checked).toBe(false);
    expect(seen.dirty).toBe(false);
  });

  test("a successful submit makes the current values the baseline", async () => {
    let seen = { dirty: true };

    const host = await mount(
      <Form action={async () => ({})} resetOnSuccess={false}>
        {({ dirty }) => {
          seen = { dirty };

          return <input name="title" defaultValue="hello" />;
        }}
      </Form>,
    );
    const input = host.querySelector("input")!;

    input.value = "saved text";
    await fire(input, "input");
    expect(seen.dirty).toBe(true);

    await act(async () => {
      host.querySelector("form")!.dispatchEvent(
        new (window as never as { Event: typeof Event }).Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(seen.dirty).toBe(false);
    expect(input.value).toBe("saved text");
  });
});
