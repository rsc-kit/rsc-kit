import { createElement } from 'react'
import type { ComponentType } from 'react'
import { fieldsOf, humanize } from './resource.js'
import type { Field, FieldOverride, FormSchema, ValuesOf } from './resource.js'

/**
 * A kind of content a page is built from - a hero, a feature grid, a call to
 * action - as a schema for what an editor fills in, and a component that
 * draws it. The component is the app's: a block looks like the site it is on.
 */
export interface Block<Schema extends FormSchema = FormSchema> {
  name: string
  label: string
  schema: Schema
  fields: Field[]
  render: ComponentType<{ data: ValuesOf<Schema> }>
}

export interface BlockDefinition<Schema extends FormSchema> {
  /** What it is saved as: lowercase letters, digits and dashes. */
  name: string
  /** What an editor picks it by. Humanized from the name by default. */
  label?: string
  /** Any Standard Schema of an object. Its fields are what an editor fills in. */
  form: Schema
  fields?: Partial<Record<keyof ValuesOf<Schema> & string, FieldOverride>>
  /** Draws it, given what passed the schema. May be an async server component. */
  render: ComponentType<{ data: ValuesOf<Schema> }>
}

/** One block as it is saved: which kind, and what was filled in. */
export interface BlockValue {
  type: string
  data: Record<string, unknown>
}

export function defineBlock<Schema extends FormSchema>(definition: BlockDefinition<Schema>): Block<Schema> {
  if (!/^[a-z0-9-]+$/.test(definition.name)) {
    throw new Error(`[press] a block's name is lowercase letters, digits and dashes: ${JSON.stringify(definition.name)}`)
  }

  const fields = fieldsOf(definition.form, definition.fields ?? {})

  if (fields.some((field) => field.type === 'blocks')) {
    throw new Error(`[press] the block ${definition.name} has a blocks field; blocks do not nest`)
  }

  return {
    name: definition.name,
    label: definition.label ?? humanize(definition.name),
    schema: definition.form,
    fields,
    render: definition.render,
  }
}

/**
 * Saved blocks, drawn in order. A block whose kind is no longer defined is
 * left out rather than failing the page: content outlives the code that drew
 * it.
 */
export function Blocks({ blocks, value }: { blocks: Block<any>[]; value: unknown }) {
  const list = Array.isArray(value) ? (value as BlockValue[]) : []

  return list.map((item, index) => {
    const block = blocks.find((candidate) => candidate.name === item?.type)

    if (!block) return null

    return createElement(block.render, { key: index, data: item.data })
  })
}
