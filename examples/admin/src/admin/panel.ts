import { definePanel, memoryInstallations } from '@rsc-kit/admin'
import { auditLog } from './plugins/audit-log'
import { categories } from './resources/categories'
import { customers } from './resources/customers'
import { products } from './resources/products'
import { chooseTeam, currentTeam, currentUser, teams } from './session'

export const panel = definePanel({
  path: '/admin',
  title: 'Admin',
  resources: [products, categories, customers],
  // The panel has no login of its own: it asks the app's.
  authorize: async () => (await currentUser()) !== null,
  user: currentUser,
  signOut: () => {},
  tenancy: { label: 'Teams', tenants: () => teams, current: currentTeam, switch: chooseTeam },
  plugins: [auditLog()],
  // Plugins installed from /admin/plugins while the app runs. Kept in memory
  // here; a real app keeps them in its database, the secret encrypted. Only
  // localhost is allowed, for the demo plugin this example serves: by default
  // a panel calls https to public names only.
  installs: { store: memoryInstallations(), allow: (url) => url.hostname === 'localhost' },
})
