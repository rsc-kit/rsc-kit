/**
 * Plugins installed while the panel runs, with no rebuild: a manifest that
 * says what the plugin adds, and an endpoint of its own that answers for it.
 *
 * Nothing a plugin wrote runs here. Its resources are drawn by the panel's
 * own components from data, its rows arrive as JSON and are shown as text,
 * and every call to it is signed with a secret made at install and scoped to
 * the tenant that installed it. What it may see of the app's own records is
 * what its scopes say, granted by a person who read them on the review page:
 *
 *     read:products   told when a product changes, and which product one of
 *                     its own records points to
 *
 * A build-time plugin (definePlugin) is code, trusted like the app's own.
 * This is the other kind: installed by a person, trusted with what they
 * granted and nothing more. design/installable-admin-plugins.md has the
 * reasoning and what is left out.
 */
import { ActionValidationError } from '@rsc-kit/core/action'
import type { RecordChange } from './plugin.js'
import { defineResource } from './resource.js'
import type { DataSource, Format, FormSchema, ListQuery, Resource, SourceContext, Tenant } from './resource.js'
import { newSecret, signedHeaders } from './signing.js'

/** A plugin, as it describes itself at its manifest url. */
export interface PluginManifest {
  /** Lowercase letters, digits and dashes; unique within a tenant. */
  name: string
  label: string
  description?: string
  version?: string
  /** Where the panel POSTs every call. Same origin as the manifest. */
  endpoint: string
  /** What it may see of the app's own resources: read:<resource>. */
  scopes: string[]
  resources: ManifestResource[]
  /** Resources whose changes it is told about: its own, or ones it may read. */
  events?: string[]
}

export type ManifestFormat = Exclude<Format, 'relation'>

export interface ManifestColumn {
  key: string
  label?: string
  format?: ManifestFormat
  /** Shown by that resource's title: one of the plugin's own, or one it may read. */
  relation?: string
  sortable?: boolean
  searchable?: boolean
}

/** The JSON Schema a manifest's form is written in: flat, one level, scalar fields. */
export interface ManifestProperty {
  type: 'string' | 'number' | 'integer' | 'boolean'
  format?: 'email' | 'date' | 'date-time' | 'textarea'
  enum?: string[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  /** For the browser's pattern attribute only: the plugin checks it, not the panel. */
  pattern?: string
  title?: string
  description?: string
  /** A belongsTo, drawn as a select of that resource's rows. */
  relation?: string
}

export interface ManifestResource {
  name: string
  label?: string
  singular?: string
  key: string
  title: string
  description?: string
  columns: ManifestColumn[]
  form: { type: 'object'; properties: Record<string, ManifestProperty>; required?: string[] }
  filters?: string[]
  perPage?: number
  mode?: 'server' | 'client'
  readOnly?: boolean
  bulkActions?: { name: string; label: string; done?: string; destructive?: boolean }[]
}

/** One plugin installed for one tenant. The secret signs every call to it. */
export interface Installation {
  /** Random; the plugin finds this installation's secret by it. */
  id: string
  manifestUrl: string
  manifest: PluginManifest
  secret: string
  /** Until someone confirms they copied the secret into the plugin, the plugins page shows it. */
  secretSeen: boolean
  installedAt: string
}

/**
 * Where installations are kept: the app's database, in a real app. Each call
 * names the tenant, and a store answers for that tenant alone - one team's
 * installs never reach another's panel. Keep `secret` encrypted at rest.
 */
export interface Installations {
  list(tenant: Tenant | null): Promise<Installation[]>
  add(tenant: Tenant | null, installation: Installation): Promise<void>
  remove(tenant: Tenant | null, id: string): Promise<void>
  /** The secret was copied into the plugin; stop showing it. */
  seen(tenant: Tenant | null, id: string): Promise<void>
}

export interface Installs {
  store: Installations
  /**
   * Whether the panel may call this url: a manifest's, and so its endpoint's.
   * By default https to a public host name - not localhost, not an address.
   * The panel's server makes the request, so a url that reaches your own
   * network is the thing to refuse; allow what your plugins are, and in
   * development, localhost.
   */
  allow?: (url: URL) => boolean
  /** Who may install and uninstall. The panel's authorize by default; an owner, usually. */
  manage?: () => boolean | Promise<boolean>
}

/** Keyed by the tenant; on globalThis because a dev server can evaluate this module twice. */
const MEMORY = Symbol.for('@rsc-kit/press.installations')

/** Installations in memory: for a demo, a test, a single process. Gone on restart. */
export function memoryInstallations(name = 'default'): Installations {
  const all = ((globalThis as Record<symbol, unknown>)[MEMORY] ??= new Map()) as Map<string, Map<string, Installation[]>>
  const kept = all.get(name) ?? new Map<string, Installation[]>()

  all.set(name, kept)

  const of = (tenant: Tenant | null) => tenant?.id ?? ''

  return {
    list: async (tenant) => [...(kept.get(of(tenant)) ?? [])],
    add: async (tenant, installation) => void kept.set(of(tenant), [...(kept.get(of(tenant)) ?? []), installation]),
    remove: async (tenant, id) => void kept.set(of(tenant), (kept.get(of(tenant)) ?? []).filter((candidate) => candidate.id !== id)),
    seen: async (tenant, id) =>
      void kept.set(
        of(tenant),
        (kept.get(of(tenant)) ?? []).map((candidate) => (candidate.id === id ? { ...candidate, secretSeen: true } : candidate)),
      ),
  }
}

// ---------------------------------------------------------------- the manifest

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const FORMATS: ManifestFormat[] = ['text', 'money', 'badge', 'boolean', 'date']
/** The panel's own url segments under its path, which no resource may take. */
export const RESERVED = ['plugins', 'new']

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max
}

/** Keys a manifest object may have. One it does not know is refused: a newer field read as nothing could be a permission ignored. */
function only(where: string, value: Record<string, unknown>, keys: string[], problems: string[]) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) problems.push(`${where}: unknown field ${JSON.stringify(key)}`)
}

/**
 * Every problem with a manifest, or none. Checked when it is reviewed, when it
 * is installed, and on every request after - the app's resources can change
 * under an installed plugin, and one that no longer fits is left out.
 */
export function manifestProblems(manifest: unknown, manifestUrl: string, host: string[]): string[] {
  const problems: string[] = []

  if (!isObject(manifest)) return ['the manifest is not a JSON object']

  only('manifest', manifest, ['name', 'label', 'description', 'version', 'endpoint', 'scopes', 'resources', 'events'], problems)

  if (typeof manifest.name !== 'string' || !NAME.test(manifest.name)) problems.push('name: lowercase letters, digits and dashes, at most 40')
  if (!text(manifest.label, 60)) problems.push('label: required, at most 60 characters')
  if (manifest.description !== undefined && !text(manifest.description, 300)) problems.push('description: at most 300 characters')
  if (manifest.version !== undefined && !text(manifest.version, 30)) problems.push('version: at most 30 characters')

  try {
    const endpoint = new URL(String(manifest.endpoint), manifestUrl)

    if (endpoint.origin !== new URL(manifestUrl).origin) problems.push('endpoint: must be on the same origin as the manifest')
  } catch {
    problems.push('endpoint: not a url')
  }

  const scopes = Array.isArray(manifest.scopes) ? manifest.scopes : null
  const readable: string[] = []

  if (!scopes) problems.push('scopes: a list, empty if it reads nothing of yours')
  else {
    for (const scope of scopes) {
      const match = typeof scope === 'string' ? /^read:([a-z0-9][a-z0-9-]*)$/.exec(scope) : null

      if (!match) problems.push(`scopes: ${JSON.stringify(scope)} is not read:<resource>`)
      else if (!host.includes(match[1]!)) problems.push(`scopes: ${scope} names a resource this panel does not have`)
      else readable.push(match[1]!)
    }
  }

  const resources = Array.isArray(manifest.resources) ? manifest.resources : null

  if (!resources || resources.length === 0 || resources.length > 20) {
    problems.push('resources: a list of 1 to 20')

    return problems
  }

  const own = resources.flatMap((resource) => (isObject(resource) && typeof resource.name === 'string' ? [resource.name] : []))
  const reachable = (name: string) => own.includes(name) || readable.includes(name)

  for (const [index, resource] of resources.entries()) {
    const where = `resources[${index}]`

    if (!isObject(resource)) {
      problems.push(`${where}: not an object`)
      continue
    }

    only(
      where,
      resource,
      ['name', 'label', 'singular', 'key', 'title', 'description', 'columns', 'form', 'filters', 'perPage', 'mode', 'readOnly', 'bulkActions'],
      problems,
    )

    const name = typeof resource.name === 'string' && NAME.test(resource.name) ? resource.name : null

    if (!name) problems.push(`${where}.name: lowercase letters, digits and dashes`)
    else if (RESERVED.includes(name)) problems.push(`${where}.name: ${name} is the panel's own`)
    else if (host.includes(name)) problems.push(`${where}.name: this panel already has a resource named ${name}`)
    else if (own.indexOf(name) !== index) problems.push(`${where}.name: two resources are named ${name}`)

    for (const key of ['label', 'singular', 'description'] as const) {
      if (resource[key] !== undefined && !text(resource[key], key === 'description' ? 300 : 60)) problems.push(`${where}.${key}: too long, or empty`)
    }

    const form = resource.form
    const properties = isObject(form) && form.type === 'object' && isObject(form.properties) ? form.properties : null

    if (!properties || Object.keys(properties).length === 0 || Object.keys(properties).length > 50) {
      problems.push(`${where}.form: a JSON Schema object with 1 to 50 properties`)
      continue
    }

    only(`${where}.form`, form as Record<string, unknown>, ['type', 'properties', 'required'], problems)

    const fieldNames = Object.keys(properties)

    if (form && (form as { required?: unknown }).required !== undefined) {
      const required = (form as { required?: unknown }).required

      if (!Array.isArray(required) || required.some((field) => !fieldNames.includes(field as string))) {
        problems.push(`${where}.form.required: names that are properties`)
      }
    }

    for (const [field, property] of Object.entries(properties)) {
      const at = `${where}.form.properties.${field}`

      if (!KEY.test(field)) problems.push(`${at}: not a field name`)
      if (!isObject(property)) {
        problems.push(`${at}: not an object`)
        continue
      }

      only(at, property, ['type', 'format', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'title', 'description', 'relation'], problems)

      if (!['string', 'number', 'integer', 'boolean'].includes(property.type as string)) problems.push(`${at}.type: string, number, integer or boolean`)
      if (property.format !== undefined && !['email', 'date', 'date-time', 'textarea'].includes(property.format as string)) {
        problems.push(`${at}.format: email, date, date-time or textarea`)
      }
      if (property.enum !== undefined && (!Array.isArray(property.enum) || property.enum.length === 0 || property.enum.some((option) => !text(option, 60)))) {
        problems.push(`${at}.enum: a list of strings`)
      }
      for (const bound of ['minLength', 'maxLength', 'minimum', 'maximum'] as const) {
        if (property[bound] !== undefined && typeof property[bound] !== 'number') problems.push(`${at}.${bound}: a number`)
      }
      // Only the browser runs it - a pattern run on the server is a regular
      // expression a stranger wrote, and one can be made to take minutes.
      if (property.pattern !== undefined && !text(property.pattern, 200)) problems.push(`${at}.pattern: at most 200 characters`)
      if (property.relation !== undefined && !(typeof property.relation === 'string' && reachable(property.relation))) {
        problems.push(`${at}.relation: ${String(property.relation)} is neither its own resource nor one its scopes read`)
      }
    }

    const fieldOf = (key: unknown) => typeof key === 'string' && (fieldNames.includes(key) || key === resource.key)

    if (typeof resource.key !== 'string' || !KEY.test(resource.key)) problems.push(`${where}.key: a field name`)
    if (!fieldOf(resource.title)) problems.push(`${where}.title: one of the form's fields, or the key`)

    const columns = Array.isArray(resource.columns) ? resource.columns : null

    if (!columns || columns.length === 0 || columns.length > 30) problems.push(`${where}.columns: a list of 1 to 30`)
    else {
      for (const [at, column] of columns.entries()) {
        const where2 = `${where}.columns[${at}]`

        if (!isObject(column)) {
          problems.push(`${where2}: not an object`)
          continue
        }

        only(where2, column, ['key', 'label', 'format', 'relation', 'sortable', 'searchable'], problems)

        if (typeof column.key !== 'string' || !KEY.test(column.key)) problems.push(`${where2}.key: a field name`)
        if (column.label !== undefined && !text(column.label, 60)) problems.push(`${where2}.label: at most 60 characters`)
        if (column.format !== undefined && !FORMATS.includes(column.format as ManifestFormat)) problems.push(`${where2}.format: ${FORMATS.join(', ')}`)
        if (column.relation !== undefined && !(typeof column.relation === 'string' && reachable(column.relation))) {
          problems.push(`${where2}.relation: ${String(column.relation)} is neither its own resource nor one its scopes read`)
        }
      }
    }

    if (resource.filters !== undefined) {
      const filters = Array.isArray(resource.filters) ? resource.filters : []

      for (const filter of filters) {
        if (typeof filter !== 'string' || !(properties[filter] as ManifestProperty | undefined)?.enum) problems.push(`${where}.filters: ${String(filter)} is not an enum field`)
      }
    }

    if (resource.perPage !== undefined && !(Number.isInteger(resource.perPage) && (resource.perPage as number) >= 1 && (resource.perPage as number) <= 100)) {
      problems.push(`${where}.perPage: 1 to 100`)
    }
    if (resource.mode !== undefined && resource.mode !== 'server' && resource.mode !== 'client') problems.push(`${where}.mode: server or client`)
    if (resource.readOnly !== undefined && typeof resource.readOnly !== 'boolean') problems.push(`${where}.readOnly: true or false`)

    if (resource.bulkActions !== undefined) {
      const actions = Array.isArray(resource.bulkActions) ? resource.bulkActions : null

      if (!actions || actions.length > 10) problems.push(`${where}.bulkActions: a list of at most 10`)
      else if (resource.readOnly === true && actions.length > 0) problems.push(`${where}.bulkActions: a read-only resource has none`)
      else {
        for (const action of actions) {
          if (!isObject(action) || typeof action.name !== 'string' || !NAME.test(action.name) || action.name === 'delete' || !text(action.label, 40)) {
            problems.push(`${where}.bulkActions: each needs a name (not delete) and a label`)
          }
        }
      }
    }
  }

  if (manifest.events !== undefined) {
    const events = Array.isArray(manifest.events) ? manifest.events : null

    if (!events) problems.push('events: a list of resource names')
    else {
      for (const event of events) {
        if (typeof event !== 'string' || !reachable(event)) problems.push(`events: ${String(event)} is neither its own resource nor one its scopes read`)
      }
    }
  }

  return problems
}

/** The scopes, as the person installing reads them. */
export function scopeWords(manifest: PluginManifest, labelOf: (resource: string) => string): string[] {
  return manifest.scopes.map((scope) => {
    const resource = labelOf(scope.slice('read:'.length)).toLowerCase()

    return `See your ${resource}: be told when one changes, and which one its own records point to.`
  })
}

// ---------------------------------------------------------- reaching a plugin

/** Https to a name: not localhost, and not an address, which is how a private network is reached by url. */
export function publicHttps(url: URL): boolean {
  if (url.protocol !== 'https:') return false

  const host = url.hostname.replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^[\d.]+$/.test(host) || host.includes(':')) return false

  return true
}

const MANIFEST_BYTES = 256 * 1024
const ANSWER_BYTES = 5 * 1024 * 1024

/** A response's body, up to a limit: a plugin that answers with gigabytes is a plugin that is wrong. */
async function bounded(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0)

  if (declared > limit) throw new Error(`[admin] the answer is ${declared} bytes, over ${limit}`)

  const body = await response.text()

  if (body.length > limit) throw new Error(`[admin] the answer is over ${limit} bytes`)

  return body
}

/** A manifest, fetched and checked. Redirects are refused: a url allowed once must not lead somewhere that was not. */
export async function fetchManifest(manifestUrl: string, allow: (url: URL) => boolean, host: string[]): Promise<PluginManifest> {
  let url: URL

  try {
    url = new URL(manifestUrl)
  } catch {
    throw new Error('That is not a url.')
  }

  if (!allow(url)) throw new Error('This panel does not install plugins from that address.')

  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => null)

  if (!response?.ok) throw new Error(`The manifest could not be fetched${response ? ` (${response.status})` : ''}.`)

  let manifest: unknown

  try {
    manifest = JSON.parse(await bounded(response, MANIFEST_BYTES))
  } catch {
    throw new Error('The manifest is not JSON.')
  }

  const problems = manifestProblems(manifest, url.href, host)

  if (problems.length > 0) throw new Error(`The manifest has problems: ${problems.join('; ')}.`)

  const checked = manifest as PluginManifest

  return { ...checked, endpoint: new URL(checked.endpoint, url).href }
}

/** A stable digest of a manifest: what was reviewed is what is installed, or the install is refused. */
export async function digestOf(manifest: PluginManifest): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest))))

  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function newInstallation(manifestUrl: string, manifest: PluginManifest): Installation {
  return { id: crypto.randomUUID(), manifestUrl, manifest, secret: newSecret(), secretSeen: false, installedAt: new Date().toISOString() }
}

/** What a plugin's endpoint is sent. `tenant` is the installation's, never one the browser named. */
export type PluginCall =
  | { type: 'list'; resource: string; query: ListQuery }
  | { type: 'find'; resource: string; id: string }
  | { type: 'create'; resource: string; values: Record<string, unknown> }
  | { type: 'update'; resource: string; id: string; values: Record<string, unknown> }
  | { type: 'delete'; resource: string; id: string }
  | { type: 'bulk'; resource: string; action: string; ids: string[] }
  | { type: 'change'; change: RecordChange }

export type PluginRequest = PluginCall & { tenant: Tenant | null }

/**
 * One signed call. A 404 is null; a 422 with `{ errors: { field: [message] } }`
 * is the form's field errors, exactly as Laravel's are; anything else that is
 * not a 2xx is a failure with the plugin's name on it.
 */
export async function callPlugin(
  installation: Installation,
  call: PluginCall,
  context: SourceContext,
  allow: (url: URL) => boolean,
  timeout = 10_000,
): Promise<unknown> {
  const endpoint = new URL(installation.manifest.endpoint)
  const name = installation.manifest.name

  // Checked again on every call: the rule can tighten after the install.
  if (!allow(endpoint)) throw new Error(`[admin] the plugin ${name}'s endpoint is no longer allowed`)

  const body = JSON.stringify({ ...call, tenant: context.tenant ? { id: context.tenant.id, name: context.tenant.name } : null })
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(await signedHeaders(installation.id, installation.secret, body)) },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  })

  if (response.status === 404) return null

  const answer = await bounded(response, ANSWER_BYTES)
  let json: unknown = null

  try {
    json = answer === '' ? null : JSON.parse(answer)
  } catch {
    throw new Error(`[admin] the plugin ${name} answered ${response.status} with something that is not JSON`)
  }

  if (response.status === 422 && isObject(json) && isObject(json.errors)) {
    const errors = Object.fromEntries(
      Object.entries(json.errors).map(([field, messages]) => [field, ([] as unknown[]).concat(messages).map(String).slice(0, 5)]),
    )

    throw new ActionValidationError(errors)
  }

  if (!response.ok) throw new Error(`[admin] the plugin ${name} answered ${response.status}`)

  return json
}

const row = (value: unknown, plugin: string): Record<string, unknown> => {
  if (!isObject(value)) throw new Error(`[admin] the plugin ${plugin} answered a row that is not an object`)

  return value
}

/** A resource's five calls, made to the plugin. */
function remoteSource(installation: Installation, resource: string, allow: (url: URL) => boolean): DataSource<Record<string, unknown>, Record<string, unknown>> {
  const plugin = installation.manifest.name
  const call = (body: PluginCall, context: SourceContext) => callPlugin(installation, body, context, allow)

  return {
    async list(query, context) {
      const answer = await call({ type: 'list', resource, query }, context)

      const cursor = (value: unknown) => typeof value === 'string' || value === null || value === undefined
      const paged = isObject(answer) && 'next' in answer && cursor(answer.next) && cursor(answer.prev)

      if (!isObject(answer) || !Array.isArray(answer.rows) || (typeof answer.total !== 'number' && !paged)) {
        throw new Error(`[admin] the plugin ${plugin} answered a list without { rows, total } or { rows, next }`)
      }

      const rows = answer.rows.map((value) => row(value, plugin))

      return paged
        ? { rows, next: (answer.next as string | null) ?? null, prev: (answer.prev as string | null | undefined) ?? null }
        : { rows, total: answer.total as number }
    },
    async find(id, context) {
      const answer = await call({ type: 'find', resource, id }, context)

      return isObject(answer) && answer.row !== undefined && answer.row !== null ? row(answer.row, plugin) : null
    },
    async create(values, context) {
      return row((await call({ type: 'create', resource, values }, context)) as { row?: unknown } | null, plugin).row as Record<string, unknown>
    },
    async update(id, values, context) {
      return row((await call({ type: 'update', resource, id, values }, context)) as { row?: unknown } | null, plugin).row as Record<string, unknown>
    },
    async delete(id, context) {
      await call({ type: 'delete', resource, id }, context)
    },
  }
}

// ------------------------------------------------------------------ the form

/**
 * A Standard Schema from the manifest's JSON Schema, so a plugin's form goes
 * through the same parse as any other. It checks what is cheap and safe to
 * check here - types, required, enums, lengths, bounds - and never `pattern`;
 * the plugin's endpoint checks everything again and answers 422.
 */
export function jsonSchemaForm(form: ManifestResource['form']): FormSchema {
  const required = new Set(form.required ?? [])

  const validate = (value: unknown): { value: Record<string, unknown> } | { issues: { message: string; path: string[] }[] } => {
    if (!isObject(value)) return { issues: [{ message: 'Expected an object', path: [] }] }

    const out: Record<string, unknown> = {}
    const issues: { message: string; path: string[] }[] = []

    for (const [name, property] of Object.entries(form.properties)) {
      const given = value[name]
      const fail = (message: string) => issues.push({ message, path: [name] })

      if (given === undefined || given === null || given === '') {
        if (required.has(name) && property.type !== 'boolean') fail('Required')
        continue
      }

      if (property.type === 'boolean') {
        if (typeof given !== 'boolean') fail('Expected true or false')
        else out[name] = given
        continue
      }

      if (property.type === 'number' || property.type === 'integer') {
        const number = typeof given === 'number' ? given : Number(given)

        if (!Number.isFinite(number)) fail('Expected a number')
        else if (property.type === 'integer' && !Number.isInteger(number)) fail('Expected a whole number')
        else if (property.minimum !== undefined && number < property.minimum) fail(`At least ${property.minimum}`)
        else if (property.maximum !== undefined && number > property.maximum) fail(`At most ${property.maximum}`)
        else out[name] = number
        continue
      }

      const string = String(given)

      if (property.enum && !property.enum.includes(string)) fail(`One of ${property.enum.join(', ')}`)
      else if (property.minLength !== undefined && string.length < property.minLength) fail(`At least ${property.minLength} characters`)
      else if (property.maxLength !== undefined && string.length > property.maxLength) fail(`At most ${property.maxLength} characters`)
      else out[name] = string
    }

    return issues.length > 0 ? { issues } : { value: out }
  }

  const json = {
    type: 'object',
    required: form.required ?? [],
    properties: Object.fromEntries(
      Object.entries(form.properties).map(([name, { relation: _relation, title: _title, format, ...property }]) => [
        name,
        { ...property, ...(format && format !== 'textarea' ? { format } : {}) },
      ]),
    ),
  }

  return {
    '~standard': {
      version: 1,
      vendor: '@rsc-kit/press/plugin',
      validate,
      jsonSchema: { input: () => json, output: () => json },
    },
  } as unknown as FormSchema
}

/** An installation's resources, as the panel's own. */
export function resourcesOf(installation: Installation, allow: (url: URL) => boolean): Resource[] {
  return installation.manifest.resources.map((described) =>
    defineResource<Record<string, unknown>>()({
      name: described.name,
      ...(described.label ? { label: described.label } : {}),
      ...(described.singular ? { singular: described.singular } : {}),
      key: described.key,
      title: described.title,
      source: remoteSource(installation, described.name, allow),
      table: (col) =>
        described.columns.map((column) => {
          const built = column.relation ? col.relation(column.key, column.relation) : col[column.format ?? 'text'](column.key)

          if (column.label) built.label(column.label)
          if (column.sortable) built.sortable()
          if (column.searchable) built.searchable()

          return built
        }),
      form: jsonSchemaForm(described.form),
      fields: Object.fromEntries(
        Object.entries(described.form.properties).flatMap(([name, property]) => {
          const override = {
            ...(property.title ? { label: property.title } : {}),
            ...(property.description ? { description: property.description } : {}),
            ...(property.format === 'textarea' ? { type: 'textarea' as const } : {}),
            ...(property.relation ? { relation: property.relation } : {}),
          }

          return Object.keys(override).length > 0 ? [[name, override]] : []
        }),
      ),
      ...(described.filters ? { filters: described.filters } : {}),
      ...(described.perPage ? { perPage: described.perPage } : {}),
      ...(described.mode ? { mode: described.mode } : {}),
      ...(described.readOnly ? { readOnly: true } : {}),
      ...(described.description ? { description: described.description } : {}),
      bulkActions: (described.bulkActions ?? []).map((action) => ({
        name: action.name,
        label: action.label,
        ...(action.done ? { done: action.done } : {}),
        ...(action.destructive ? { destructive: true } : {}),
        run: async (rows: Record<string, unknown>[], context: SourceContext) => {
          const answer = await callPlugin(
            installation,
            { type: 'bulk', resource: described.name, action: action.name, ids: rows.map((found) => String(found[described.key])) },
            context,
            allow,
          )

          return isObject(answer) && typeof answer.message === 'string' ? answer.message.slice(0, 200) : undefined
        },
      })),
    }),
  )
}

/** Whether a plugin is told about a change: one of its events, which its scopes or ownership allow. */
export function wantsChange(installation: Installation, change: RecordChange): boolean {
  return installation.manifest.events?.includes(change.resource) ?? false
}
