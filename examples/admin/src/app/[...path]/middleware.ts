import { site } from '@/site/pages'

// Asks whether there is a page here before anything is sent, so an address
// with none is a real 404 rather than a 200 whose shell went out first.
export default site.middleware
