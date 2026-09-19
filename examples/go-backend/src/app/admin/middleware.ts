// Guards in the Go process's vocabulary. No route is declared in Go; the
// renderer asks for these by name before anything here renders, and the Go
// side runs the guards it registered as "auth" and "can".
export const middleware = ['auth', 'can:manage-orders']
