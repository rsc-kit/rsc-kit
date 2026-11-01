import type { DataSource, SourceContext } from './resource.js'

/**
 * A source per tenant, made the first time a tenant is asked for and kept.
 * For data that is split by tenant before it reaches you - a database per
 * team, an API key per customer, rows in memory for a demo:
 *
 *     source: perTenant((tenant) => memorySource(seed(tenant), 'id', make))
 *
 * A source that filters one table by a tenant column needs none of this: it
 * reads context.tenant in each call.
 */
export function perTenant<Row, Values>(make: (tenantId: string) => DataSource<Row, Values>): DataSource<Row, Values> {
  const made = new Map<string, DataSource<Row, Values>>()
  const of = ({ tenant }: SourceContext) => {
    if (!tenant) throw new Error('[admin] perTenant() is for a panel with tenants; this request has none')

    let source = made.get(tenant.id)

    if (!source) made.set(tenant.id, (source = make(tenant.id)))

    return source
  }

  return {
    list: (query, context) => of(context).list(query, context),
    find: (id, context) => of(context).find(id, context),
    create: (values, context) => of(context).create(values, context),
    update: (id, values, context) => of(context).update(id, values, context),
    delete: (id, context) => of(context).delete(id, context),
  }
}
