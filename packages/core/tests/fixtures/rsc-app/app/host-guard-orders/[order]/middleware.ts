// A guard on a route with a param: the host is sent the page beside the
// names, so a policy on {order} has an order to bind.
export const middleware = ['can:view,order']
