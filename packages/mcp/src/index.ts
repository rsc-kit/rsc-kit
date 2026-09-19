#!/usr/bin/env node
// An MCP server over what an rsc-kit build decided.
//
//   claude mcp add rsc-kit -- npx -y @rsc-kit/mcp
//
// Four questions, all answered from `build-report.json` and none of them
// requiring the app to be running:
//
//   what routes exist, and what happened to each
//   why is this one not stored
//   which ones render per request
//   which ones cost the browser the most
//
// Why a server rather than letting an agent read the file: the file is JSON
// with a `type` field whose values mean nothing without the documentation, and
// an agent reading it guesses — "shell" invites being treated as a failure when
// it is the normal, correct outcome for a page with data in it. These answers
// say what each state means, in the same words the build printed.
//
// Everything is read-only. There is no tool here that edits, builds or deploys,
// deliberately: an agent already has a shell for those, and a server that can
// change the project is one that can change it while answering a question.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { explainRoute, heaviestRoutes, listRoutes, whatIsDynamic } from './answers.js'
import { NoReport, loadReport } from './report.js'
import { howTo, listTopics } from './recipes.js'
import { listGuides, readGuide, searchGuides } from './bundleGuides.js'

/** The project to read, from the argument or the working directory. */
const root = process.argv[2] ?? process.cwd()

/**
 * Loaded per call, never cached.
 *
 * A build happens while this server is running — that is the normal case, not
 * the exception — and an answer from the build before it is worse than a slow
 * one. The file is small and this is not a hot path.
 */
const read = () => loadReport(root)

/**
 * Declared once, outside the call.
 *
 * Inline, TypeScript walks the sdk's tool generics against the zod shape and
 * gives up with "type instantiation is excessively deep" — a compiler limit
 * rather than anything wrong with the schema. A named const with the handler's
 * argument annotated stops the inference chain before it gets there.
 */
const URL_ARG = { url: z.string().describe('The url, e.g. /orders or /posts/hello') }
const TOPIC_ARG = { topic: z.string().describe('One of the topics from list_topics, e.g. forms or validation') }
const SLUG_ARG = { slug: z.string().describe('One of the slugs from list_guides, e.g. forms or server-actions') }
const PHRASE_ARG = { phrase: z.string().describe('A word or phrase, e.g. fieldErrors or metadataBase') }

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] })

/** A missing report is an answer, not a crash: it says to run a build. */
const answering = (produce: () => string) => {
  try {
    return text(produce())
  } catch (error) {
    if (error instanceof NoReport) return text(error.message)

    throw error
  }
}

/**
 * The registration surface, named rather than inferred.
 *
 * `registerTool` is generic over the zod shape, and TypeScript walks those
 * generics until it gives up — "type instantiation is excessively deep", which
 * is a compiler limit rather than anything wrong with the schema. Describing
 * the one method used, with the argument type written out, stops the inference
 * before it gets there and costs nothing: the schemas below are still real zod
 * and still validate at runtime.
 */
interface Registrar {
  registerTool(
    name: string,
    config: {
      title?: string
      description?: string
      inputSchema?: Record<string, unknown>
      annotations?: { readOnlyHint?: boolean }
    },
    handler: (args: never) => Promise<{ content: { type: 'text'; text: string }[] }>,
  ): unknown
  connect(transport: StdioServerTransport): Promise<void>
}

const server = new McpServer({ name: 'rsc-kit', version: '0.1.0' }) as unknown as Registrar

server.registerTool(
  'list_routes',
  {
    title: 'List routes',
    description:
      'Every route in this rsc-kit app, what the build did with each one, and how much javascript it ships. Start here when you need to know what exists.',
    annotations: { readOnlyHint: true },
  },
  async () =>
    answering(() => {
      const { report, builtAt } = read()

      return listRoutes(report, builtAt, Date.now())
    }),
)

server.registerTool(
  'explain_route',
  {
    title: 'Explain a route',
    description:
      'Why one url is stored at build time or rendered per request, what renders it, and what it costs the browser. Use this before changing a page to make it faster — the reason is recorded, not guessed.',
    inputSchema: URL_ARG,
    annotations: { readOnlyHint: true },
  },
  (async ({ url }: { url: string }) =>
    answering(() => {
      const { report, builtAt } = read()

      return explainRoute(report, url, builtAt, Date.now())
    })) as never,
)

server.registerTool(
  'what_is_dynamic',
  {
    title: 'What renders per request',
    description:
      'The routes that render per request rather than being stored, each with the reason. This is the answer to "why is this site not static".',
    annotations: { readOnlyHint: true },
  },
  async () =>
    answering(() => {
      const { report, builtAt } = read()

      return whatIsDynamic(report, builtAt, Date.now())
    }),
)

server.registerTool(
  'heaviest_routes',
  {
    title: 'Heaviest routes',
    description: 'The routes that make the browser download the most javascript, largest first.',
    annotations: { readOnlyHint: true },
  },
  async () =>
    answering(() => {
      const { report, builtAt } = read()

      return heaviestRoutes(report, builtAt, Date.now())
    }),
)

server.registerTool(
  'how_to',
  {
    title: 'How to build it',
    description:
      'How to do something in an rsc-kit app — forms, prefetching, validation, the action client, data loading with TanStack Query or SWR, Suspense boundaries, offline, PWA, api routes, authorization, a Laravel or other backend, once-per-process startup, and why a page is dynamic. Read this BEFORE writing the code: the patterns here differ from Next and plain React in ways that compile either way. The short answer; read_guide has the full one.',
    inputSchema: TOPIC_ARG,
    annotations: { readOnlyHint: true },
  },
  (async ({ topic }: { topic: string }) => text(howTo(topic))) as never,
)

server.registerTool(
  'list_topics',
  {
    title: 'What this server can explain',
    description: 'Every topic how_to knows about, one line each.',
    annotations: { readOnlyHint: true },
  },
  async () => text(listTopics()),
)

server.registerTool(
  'list_guides',
  {
    title: 'The guides',
    description: 'Every guide from docs.rsc-kit.dev, bundled with this server — the full text behind how_to, one line each.',
    annotations: { readOnlyHint: true },
  },
  async () => text(listGuides()),
)

server.registerTool(
  'read_guide',
  {
    title: 'Read a guide',
    description:
      'The complete guide for one topic, as published at docs.rsc-kit.dev — routing, forms, server-actions, validation, metadata, testing, deployment and the rest. Use it when how_to is not enough or names something it does not explain.',
    inputSchema: SLUG_ARG,
    annotations: { readOnlyHint: true },
  },
  (async ({ slug }: { slug: string }) => text(readGuide(slug))) as never,
)

server.registerTool(
  'search_guides',
  {
    title: 'Search the guides',
    description: 'Every line in the guides that mentions a word or phrase, with the guide it is in. Use it to find which guide covers something before reading it.',
    inputSchema: PHRASE_ARG,
    annotations: { readOnlyHint: true },
  },
  (async ({ phrase }: { phrase: string }) => text(searchGuides(phrase))) as never,
)

await server.connect(new StdioServerTransport())
