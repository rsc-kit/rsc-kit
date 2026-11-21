/**
 * The FormData entry `<Honeypot />` adds beside its trap, naming the trap's
 * field. The engine reads it on every action post and takes both out before
 * the action sees the form. Only a form that rendered `<Honeypot />` carries
 * it, so a field of the same name on any other form is an ordinary field.
 */
export const TRAP_FIELD = "$rsc:trap";

/** The trap's default name: one a form might really have, which is what a bot looks for. */
export const DEFAULT_TRAP = "homepage";
