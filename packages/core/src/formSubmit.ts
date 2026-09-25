"use server";

// What a <Form> posts to before it has a runtime.
//
// React seats the answer to a form posted without javascript into the form
// that posted it - through useActionState, which hands the action a
// (previousState, formData) pair. A Form's action takes the FormData alone,
// and every action written against the guide does; so the form is registered
// with this, bound to its real action, and this is the pair-shaped function
// React calls. The action is a server reference travelling as a bound
// argument, decoded back to itself on the way in.

export async function submitForm(
  action: (formData: FormData) => Promise<unknown>,
  _previous: unknown,
  formData: FormData,
): Promise<unknown> {
  return await action(formData);
}
