// The host's guards, in the file named for them. No default export: nothing
// here runs on the engine, so the engine must not import it as a guard.
export const middleware = ['auth', 'can:view,admin']
