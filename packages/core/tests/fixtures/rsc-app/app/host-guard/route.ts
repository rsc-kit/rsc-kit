// Guards the host runs, named here and meaningless to the engine.
//
// No route is declared — the file tree is the routing. This says only what
// must hold before anything at or below this directory renders, in the host's
// own vocabulary: Laravel middleware aliases, a Go router's names.
//
// throttle carries comma-separated arguments on purpose. A parser that splits
// the list on commas turns it into a throttle of 60 and a middleware called 1.
export const middleware = ['auth', 'can:view,admin', 'throttle:60,1']
