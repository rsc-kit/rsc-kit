// Scalar's API Reference over the document the build derives from the
// route.ts files - rscKit({ openapi }) in vite.config.ts. The page is
// Scalar's own; nothing here is rendered by this app.
import { ApiReference } from '@scalar/nextjs-api-reference'

export const GET = ApiReference({ url: '/openapi.json' })

// Not part of the API it documents.
export const openapi = false
