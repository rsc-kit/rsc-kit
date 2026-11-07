// Whether what we publish for agents still says what the framework does.
//
// The recipes are hand-written copies of the guides, and a copy is only as
// current as the last person who remembered. This is the memory: every
// behaviour an app author can observe or has to act on is a line in FACTS, with
// the text that proves the recipe and the guide each say it. Add a line in the
// same PR as the change - CLAUDE.md, "What Agents Are Told Is Part of the
// Change". The Boost skill (rsc-kit/laravel) keeps the same list for its side
// in tests/Unit/BoostSkillTest.php.

import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TOPICS, howTo } from '../src/recipes'

const REPO = join(import.meta.dir, '../../..')
const DOCS = join(REPO, 'docs/src/content/docs')

function read(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) =>
      entry.isDirectory()
        ? read(join(dir, entry.name))
        : /\.mdx?$/.test(entry.name)
          ? readFileSync(join(dir, entry.name), 'utf-8')
          : '',
    )
    .join('\n')
}

const recipes = TOPICS.map((topic) => howTo(topic)).join('\n')
const guides = read(DOCS)

interface Fact {
  /** What an agent must be told, as a person would say it. */
  fact: string
  /** Text the recipes must contain. */
  recipe: RegExp
  /** Text the guides must contain. */
  guide: RegExp
  /**
   * Text the Boost skill in rsc-kit/laravel must contain - the same needle its
   * BoostSkillTest holds. Null only with a `why`: a fact Laravel apps never meet.
   */
  boost: string | null
  why?: string
}

const FACTS: Fact[] = [
  { fact: 'whether a CDN answered is its own entry in Cache-Status, since X-RSC-Kit is stored with the copy', recipe: /entry in Cache-Status/, guide: /read `Cache-Status`/, boost: 'Cache-Status' },
  { fact: 'refuse(message, data) declines on purpose, with data the page acts on', recipe: /refuse\(message, data\)/, guide: /refuse\(/, boost: 'Rsc::refuse(' },
  { fact: 'a backend refusal with a status keeps its message, and an abort() without one says "Refused."', recipe: /Refused\./, guide: /Refused\./, boost: 'Refused.' },
  { fact: 'formRefusal is typed from the form\'s action, with no cast', recipe: /formRefusal, typed from the form's/, guide: /formRefusal/, boost: 'formRefusal' },
  { fact: 'a redirected call to a backend action resolves { redirected }; narrow it with isRedirected', recipe: /isRedirected/, guide: /isRedirected/, boost: 'isRedirected' },
  { fact: 'a page never answers an image, script, stylesheet or font request', recipe: /Sec-Fetch-Dest/, guide: /Sec-Fetch-Dest/, boost: 'Sec-Fetch-Dest' },
  { fact: 'app.markup(path) is the page without its scripts, for asserting on what is shown', recipe: /markup\(/, guide: /markup\(/, boost: 'app.markup(path)' },
  { fact: 'a notFound() decided after the shell shows not-found.tsx where the page was, and error.tsx never sees it', recipe: /where the page was/, guide: /where the page was/, boost: 'where the page was' },
  { fact: 'through a generated stub a backend refusal reaches the form as its message, and its data does not', recipe: /Through a generated stub/, guide: /Through a generated stub/, boost: 'Through a generated stub' },
  { fact: 'a not-found.tsx beside a layout answers notFound() from the pages under it, inside that layout; the nearest wins', recipe: /nearest one above the page wins/, guide: /nearest one above the page that said so wins/, boost: 'the nearest one above the page wins' },
  { fact: 'a stub awaited directly rejects with ActionRefusedError when the backend refuses it', recipe: /ActionRefusedError/, guide: /ActionRefusedError/, boost: 'ActionRefusedError' },
  { fact: 'a stub whose input was refused rejects with ServerValidationError; only a redirect resolves', recipe: /ServerValidationError \(@rsc-kit\/core\/errors/, guide: /ServerValidationError. with `\.fieldErrors`/, boost: 'ServerValidationError' },
  { fact: 'a server-only engine module in the browser bundle fails the build, and your own server files use import \'server-only\'', recipe: /ended up in the\s+browser bundle/, guide: /A server module in the browser bundle/, boost: 'ended up in the browser bundle' },
  { fact: 'error() and clearErrors() are typed from the action\'s input, so a typo fails tsc', recipe: /TYPED from the action's input/, guide: /### Field names|\[Field names\]/, boost: 'FieldNamesOf' },
  { fact: 'a wrapper around a stub declares its form fields with FormFields<N> on its parameter', recipe: /FormFields<'id' \| 'name'>/, guide: /FormFields<'id' \| 'name'>/, boost: 'FormFields' },
  { fact: 'a team-scoped stub is a form action as stub.bind(null, team), bound into a const; a form that posts nothing names fields with the fields prop', recipe: /stub\.bind\(null, team\)[\s\S]*fields=\{\['size'\]\}/, guide: /Bind into a `const` first/, boost: 'bind(null, team)' },
  { fact: 'a change made straight in the database says nothing to open tabs; the writer calls changed(), or a trigger moves the version row', recipe: /A DIRECT DATABASE EDIT/, guide: /A change made straight in the database/, boost: 'straight in the database' },
  { fact: 'backendPaths forwards a backend prefix before any page is matched, so a dynamic root route cannot shadow it', recipe: /backendPaths: \['\/auth'/, guide: /backendPaths: \['\/auth'/, boost: 'backendPaths' },
  { fact: 'a page\'s own share image is an opengraph-image file in its folder (nearest wins), and an exported openGraph.images replaces the site\'s instead of following it', recipe: /A page's OWN share image is a file beside it/, guide: /### A page's own share image/, boost: 'opengraph-image' },
  { fact: 'a file in src/commands is a release step or a worker, run as ./app <name> or node .output/server/commands.mjs <name>; its return value is the exit code, and instrumentation.ts\'s register() runs only for one that exports register = true', recipe: /export const register = true/, guide: /export const register = true/, boost: 'src/commands' },
  { fact: 'a section beside a layout is refreshed by name from any page under that layout, so what every tab shares (a header, a status) lives in the layout and does not go away between tabs; a page\'s own section of a name shadows its layout\'s', recipe: /A LAYOUT'S REGION/, guide: /beside each of its layouts/, boost: 'beside its layouts' },
  { fact: 'a section is exported by a name (const Repos = section(...); export default Repos), because an editor offers an import by the name a default export has and a call has none', recipe: /offered as reposSection/, guide: /OrdersSection/, boost: 'export default Repos' },
  { fact: 'a section is named by its file, and a section() name that differs fails the build', recipe: /the name is the file's: repos\.section\.tsx is section\('repos'\)/, guide: /the build refuses\s+one, and says which file to rename/, boost: 'name it after its file', why: 'an app author who names a section differently from its file sees revalidate() typecheck and then refresh nothing' },
  { fact: 'a built server started with no NODE_ENV sets the mode it was built in, in its own process, before the app loads', recipe: /sets the one it was built with in its own process/, guide: /gives its own process the mode it was built\s+in/, boost: 'started with no `NODE_ENV` sets the one it was built with', why: 'an app author who sets NODE_ENV for the renderer, or reads it through a spread, needs to know the process has it' },
  { fact: 'a refreshed section is swapped in as a transition: it keeps what it showed until the new content is ready, never its skeleton', recipe: /A refresh is swapped in as a\s+transition/, guide: /A refresh keeps the section on screen until it is ready/, boost: null, why: 'nothing for an app author to do or avoid; the skill does not describe how a section is swapped in' },
  { fact: 'a link on screen asks for its payload again when it comes back into view or the tab is visible again, which is a request only once the held payload expired, and there is no timer', recipe: /link comes back into view or the tab is visible again/, guide: /A link asks\s+again when it comes back into view/, boost: null, why: 'Link prefetching is the engine\'s and the app author does nothing for it; the skill does not describe when a Link prefetches' },
  { fact: 'a command does not import instrumentation.ts unless it exports register = true as a literal: the rest run from a bundle that leaves it out, so its env validation does not run for them, and a command validates what it imports', recipe: /does NOT import this one unless it/, guide: /By default it is not imported/, boost: 'does not import `instrumentation.ts` unless it exports `register = true`' },
  { fact: 'a command\'s second argument is the context { signal, deadline }, typed CommandContext from @rsc-kit/core/commands (defineCommand types a command); deadline is a getter, so it is read as context.deadline and never destructured, and signal can already be aborted when the command starts, so signal.aborted is checked before waiting on abort', recipe: /do NOT destructure it/, guide: /Do not destructure deadline/, boost: null, why: 'a Laravel app\'s workers and release steps are artisan\'s; the skill describes src/commands only as the renderer\'s own occasional work and does not teach the worker API' },
  { fact: 'a stop before the first line of a compiled binary is the default action (143), and Bun parses the whole binary first, so a binary that runs workers is compiled with --splitting', recipe: /--splitting/, guide: /--splitting/, boost: null, why: 'only a worker run from a compiled binary meets it, and a Laravel app drains its queue with artisan, so the skill does not teach compiling workers' },
  { fact: 'a stop reaches a command before it starts (the signal is already aborted and its event has fired) or after (the event fires while it runs), so a command that waits checks signal.aborted as it starts AND listens for abort', recipe: /needs BOTH/, guide: /needs both/, boost: null, why: 'a Laravel app\'s workers are artisan\'s; the skill does not teach the worker API' },
  { fact: 'a compiled binary carries the native packages the build traced and writes them on its first start to RSC_KIT_RUNTIME_DIR (default: beside the binary), so it needs a writable directory; compiling for another platform without that platform\'s packages installed fails the build and names them', recipe: /RSC_KIT_RUNTIME_DIR/, guide: /RSC_KIT_RUNTIME_DIR=\/tmp\/app/, boost: null, why: 'only a compiled binary meets it, and a Laravel app\'s renderer is not usually shipped as one, so the skill does not teach compiling' },
  { fact: 'the compile step is two scripts, compile (vite build && bun run compile:binary) and compile:binary (bun build --compile alone), and the build marker names compile:binary, so a deploy that has just built does not build again; a compile holding both builds twice and the build says so', recipe: /do NOT put vite build back inside compile:binary/, guide: /a deploy runs that one, so it\s+builds once/, boost: null, why: 'only a compiled binary meets it, and a Laravel app\'s renderer is not usually shipped as one, so the skill does not teach compiling' },
  { fact: '--sourcemap with --compile writes .map files beside the binary (one per chunk with --splitting), which the binary does not read, so only dist/app is shipped', recipe: /rm -f dist\/\*\.map/, guide: /rm -f dist\/\*\.map/, boost: null, why: 'only a compiled binary meets it, and a Laravel app\'s renderer is not usually shipped as one, so the skill does not teach compiling' },
  { fact: 'a GET <Form> whose action is the page on screen keeps that page and its old results up while the query runs, with pending true until the new results land (no shell, no skeleton); a Link or visit() to the same path is still a page of its own', recipe: /A SEARCH ON THE PAGE IT IS ON/, guide: /### A search on the page it is on/, boost: 'search on the page it is on' },
  { fact: 'error.tsx\'s reset() asks the server for the page again (layouts kept) and renders the answer, so Try again recovers from a failure that has passed; no refresh() or reload beside it', recipe: /reset\(\) ASKS THE SERVER AGAIN/, guide: /`reset\(\)` asks the server for the page again/, boost: 'asks the server for the page again' },
  { fact: 'instrumentation.ts\'s onRequest() is called once each response is over - last byte sent or the visitor gone mid-stream (aborted) - with durationMs, status, a pathname without its query and only the headers onRequestHeaders names; it is the request log, not middleware', recipe: /Request logging: export onRequest\(\)/, guide: /## Logging requests/, boost: null, why: 'the skill does not teach instrumentation.ts: a Laravel app logs its requests in Laravel, and the renderer\'s own log is the engine docs\' to describe' },
  { fact: 'the build names a server file whose code, or a library\'s under it, reaches a hook the server lacks (fails as "useState is not a function"); add "use client" to it; icons and packages with their own directive are not named', recipe: /server files reach client-only React/, guide: /reaches a hook the server does not have/, boost: null, why: 'the build note is the engine\'s; a Laravel app\'s components follow the same rule the skill already states for "use client"' },
  { fact: 'a command that throws exits 1 with the error and every cause under it on a [cause]: line, so a wrapped database error says why', recipe: /each cause on a \[cause\]: line/, guide: /each on a `\[cause\]:` line/, boost: null, why: 'the skill sends migrations and workers to artisan, not src/commands, so the database errors this is about reach a Laravel app through Laravel\'s own output' },
  { fact: 'a backend 401, 403 or 404 behind a generated stub (a plain "use server" function) reaches the form as its message and rejects a direct await with ActionRefusedError and that status, never a 500', recipe: /a backend 404 in an action\nis its message, never a 500/, guide: /An action has no not-found\n  page, so a 404 is the message, never a 500/, boost: 'in an action, the message as `formError`' },
  { fact: 'every server build writes .output/edge.json, the edge contract (v2) marker: the url patterns of the shells and the concrete paths of the static pages an edge may serve from its cache, each less every guarded or host-bound page, at most 200 each; /_edge/page and /_edge/resume answer only the EDGE_TOKEN; never derived from the rsc-static files', recipe: /edge\.json[\s\S]*EDGE_TOKEN/, guide: /`\.output\/edge\.json`[\s\S]*EDGE_TOKEN/, boost: null, why: 'a Laravel app is deployed behind Laravel, which proxies every page to the renderer; an edge that caches pages is a platform\'s, and the skill does not teach deploying one' },
  { fact: 'the edge contract build covers every stored page, shell and postponed state as well as the client bundle, so a release changing only what the server renders is a new build; it is not the version a tab reloads for', recipe: /build covers\s+the client bundle and every stored page's bytes/, guide: /client bundle and the bytes of every stored page/, boost: null, why: 'what an edge checks a cached page against; a Laravel app has no such edge in front of it' },
  { fact: 'a root middleware.ts is above every page, so it empties both edge.json lists, and the build names the middleware that kept each page out', recipe: /root\nmiddleware\.ts[\s\S]*empties both lists/, guide: /A root `middleware\.ts` empties both lists/, boost: null, why: 'an edge in front of the renderer is a platform\'s; a Laravel app sets its security headers in Laravel' },
  { fact: 'rscKit({ headers }) sets fixed headers on every response and hands them to an edge with each page, so security headers no longer need a root middleware that keeps every page out of edge.json; only the contract allow list, never Cache-Control or Link', recipe: /rscKit\(\{ headers: \{ 'X-Frame-Options':/, guide: /The ones that are the same on every page go in the config/, boost: null, why: 'a Laravel app sets its security headers in Laravel middleware, which every page passes through on its way to the renderer, and has no edge contract in front' },
  { fact: 'a Go type with its own MarshalJSON is unknown in TypeScript unless it has a JSONSchema method, which is then its type', recipe: /give the type a JSONSchema method/, guide: /Give the type a `JSONSchema` method that says it/, boost: null, why: 'a Go host\'s types; a Laravel app\'s rpc() types come from PHP signatures' },
  { fact: 'a refreshed section in a layout keeps what the refresh rendered across a visit to another page under that layout', recipe: /What a refresh rendered lasts\s+as long as the layout/, guide: /A refresh lasts as long as its layout/, boost: null, why: 'a fix to the router; the skill already says a layout\'s section is refreshed by name and never said a navigation undid it' },
  { fact: 'a static page an edge serves boots with no request to the origin: its payload is an immutable /assets/_rsc/<hash>.rsc named in its document', recipe: /\/assets\/_rsc\/<hash>\.rsc \(immutable\)/, guide: /`\/assets\/_rsc\/<hash>\.rsc`/, boost: null, why: 'an edge in front of the renderer is a platform\'s; a Laravel app serves its pages through Laravel' },
  { fact: 'a query takes its schema\'s input, and cannot redirect', recipe: /a query cannot redirect/, guide: /A query cannot redirect/, boost: 'It cannot redirect' },
  { fact: 'a crawler is answered once the page has finished, so it gets the real 404', recipe: /crawler/, guide: /crawler/i, boost: 'crawler' },
  { fact: 'type-aware lint rules catch a Redirected read as text', recipe: /restrict-template-expressions/, guide: /restrict-template-expressions/, boost: 'restrict-template-expressions' },
  { fact: 'a client component is tested by mounting it, with the DOM registered by the file\'s first import', recipe: /import '\.\/dom'/, guide: /import '\.\/dom'/, boost: 'import \'./dom\'' },
  { fact: 'createTestApp refuses to run while a DOM is registered globally', recipe: /createTestApp then refuses|refuses to run/, guide: /refuses to run while a DOM/, boost: '`createTestApp` refuses to run' },
  { fact: 'a url named in backendPaths is a document load in the browser, never a page: a Link, visit() or redirect() to it loads the document and is never prefetched, so the backend route may bounce on to another site; unnamed, the router fetches it as a payload and the bounce fails with nothing happening; a redirect to another site works as written, and the url that redirected is replaced in history', recipe: /A named prefix is also a DOCUMENT LOAD/, guide: /## Leaving the app/, boost: 'never a page in the browser' },
  { fact: 'a prefix named in backendPaths is typed as a Route (RegisterBackend in the generated rsc-routes.d.ts), so a Link or redirect() to it needs no cast; the prefix is a segment boundary, so /gitlabs is still refused', recipe: /no `as Route`/, guide: /## The backend's urls/, boost: 'needs no cast' },
  { fact: 'a backend leaves the same one-time message: Rsc::flash() in Laravel, rsckit.Flash in Go, shown by the same useFlash()', recipe: /Laravel Rsc::flash\('Invoice sent\.'\)/, guide: /`Rsc::flash\('Invoice sent\.'\)` leaves a message for the page the visitor\s+lands/, boost: "Rsc::flash('" },
  { fact: 'a one-time message survives a redirect: flash() in the action, useFlash() in a client component, taken by the browser', recipe: /A MESSAGE FOR THE NEXT PAGE/, guide: /A page never reads it, so a stored or edge-cached page stays\s+cacheable/, boost: 'useFlash' },
  { fact: 'an admin resource\'s form is any Standard Schema; one without Standard JSON Schema lists its fields', recipe: /THE FORM IS ANY STANDARD SCHEMA/, guide: /Standard JSON Schema/, boost: 'any Standard Schema' },
  { fact: 'an admin number field arrives as a number: z.number(), not z.coerce.number()', recipe: /NOT z\.coerce\.number\(\)/, guide: /not\s+`z\.coerce\.number\(\)`/, boost: 'not z.coerce.number()' },
  { fact: 'an admin data source is five functions told the context { tenant }, and find answering null is a 404', recipe: /The last argument of every call is the context \{ tenant \}/, guide: /told the\s+tenant as its last argument/, boost: '{ tenant }' },
  { fact: 'an admin table is server mode (one page per request) or client mode (list once with perPage: null)', recipe: /perPage: null and returns EVERY row/, guide: /once with `perPage: null`/, boost: 'perPage: null' },
  { fact: 'an admin panel\'s authorize runs on every page and every save, delete and switch, and a refusal is a 404', recipe: /every page AND every save, delete and tenant switch/, guide: /on every save, delete and team switch/, boost: 'authorize' },
  { fact: 'an admin panel refuses a current tenant that is not one of the visitor\'s', recipe: /refuses a current\s+tenant that is not in tenants\(\)/, guide: /is not one of the visitor's own/, boost: 'tenants()' },
  { fact: 'an admin panel is mounted by seven route files, and the section is admin-table.section.tsx', recipe: /MUST be named admin-table\.section\.tsx/, guide: /must be named `admin-table\.section\.tsx`/, boost: 'admin-table.section.tsx' },
  { fact: 'an admin plugin\'s onChange runs after the write and a throw never fails the save; publish with peers and the rsc-kit-admin-plugin keyword', recipe: /rsc-kit-admin-plugin/, guide: /rsc-kit-admin-plugin/, boost: 'rsc-kit-admin-plugin' },
  { fact: 'an admin form is checked by the browser first, from the schema\'s constraints, with the message in FieldError; the server still checks every save', recipe: /BROWSER CHECK/, guide: /Checked in the browser first/, boost: 'Checked in the browser first' },
  { fact: 'an admin resource can take the backend\'s generated actions instead of a schema, update taking the key second, as the FormRequest\'s route parameter', recipe: /the KEY COMES SECOND/, guide: /The key reaches the FormRequest as its route parameter/, boost: "ignore($this->route('product'))" },
  { fact: 'an admin list answers { rows, total } for numbered pages or { rows, next, prev } to page by cursor, told the cursor as query.cursor', recipe: /PAGES BY COUNT OR BY CURSOR/, guide: /Pages by count, or by cursor/, boost: 'cursorPaginate' },
  { fact: 'a backend\'s 422 from an admin source\'s create or update shows under the form\'s fields, uncaught', recipe: /A BACKEND 422/, guide: /the panel treats the backend's refusal and its\s+own the same way/, boost: 'Nothing to catch' },
  { fact: 'the admin panel is @rsc-kit/press: definePanel from /admin, drawn by a theme from /shadcn; @rsc-kit/admin is gone', recipe: /There is no @rsc-kit\/admin any more/, guide: /`@rsc-kit\/press\/shadcn` - the shadcn theme/, boost: '@rsc-kit/press/shadcn' },
  { fact: 'a panel theme is an object of components given data, bound actions and drawn elements; spread shadcn to replace one page', recipe: /a theme only draws/, guide: /To change one page, spread the shipped theme/, boost: '...shadcn' },
  { fact: 'an admin relation is a select of another resource\'s rows, listed and checked as the visitor', recipe: /RELATIONS \(belongsTo\)/, guide: /an id posted\s+by hand from another tenant is refused under the field/, boost: "relation: 'categories'" },
  { fact: 'an admin bulk action is given rows found as the visitor, after authorize', recipe: /BULK ACTIONS: /, guide: /never\s+reaches it\. It runs after `authorize`/, boost: 'bulkActions' },
  { fact: 'a redirect from an action keeps the layouts unless the action called revalidate before it', recipe: /call revalidate\('all'\) BEFORE redirect\(\)/, guide: /`revalidate\('all'\)` before the `redirect\(\)` asks for\s+the destination whole/, boost: "revalidate('all') before" },
  { fact: 'a form is a blueprint, defineBlueprint from @rsc-kit/press/forms, placed as <form.Form /> in a page that stays static', recipe: /@rsc-kit\/press\/forms/, guide: /`@rsc-kit\/press\/forms` - `defineBlueprint`/, boost: 'defineBlueprint' },
  { fact: 'a blueprint with update edits a record when drawn with an id, and the key comes back from the browser, so update checks the visitor may change it', recipe: /THE KEY COMES BACK FROM THE BROWSER/, guide: /The key comes back from the browser/, boost: '.Form id={' },
  { fact: 'an admin resource takes a blueprint as its form, and saves with the blueprint\'s own saves when it has them', recipe: /IN A PANEL: defineResource/, guide: /hand it to the\nresource as its `form`/, boost: 'form: profile' },
  { fact: 'a form field shows only while another has a value, with visible: { when, is }; a hidden field is not sent and the server drops one sent anyway; required_if is read as visible', recipe: /VISIBLE: fields: \{ company: \{ visible/, guide: /if a post sends one anyway, the server drops it/, boost: 'visible: { when' },
  { fact: 'a form field filled from another as a slug with from: { field }, until edited by hand', recipe: /FROM: fields: \{ slug: \{ from/, guide: /Once someone edits it by hand it is left\s+alone/, boost: "from: { field" },
  { fact: 'a backend guard runs against the page it guards - its url and its route\'s params, never the query - so signed, can: with a bound model and a per-visitor throttle work, asked once per page load', recipe: /They run against the page's request, not the host call's/, guide: /run through the real pipeline against that\npage's request/, boost: "against the page's request" },
  { fact: 'every host call carries the visitor\'s address, so a backend throttle counts per visitor; RSC_TRUST_FORWARDED=1 behind a balancer', recipe: /carries the visitor's address\n\(X-Rsc-Client-Ip\)/, guide: /`X-Rsc-Client-Ip` is the visitor's address/, boost: 'X-Rsc-Client-Ip' },
  { fact: 'a public form drops a submission whose homepage bot trap is filled, answering it as a success', recipe: /hidden field named homepage/, guide: /The trap is named `homepage`/, boost: 'homepage' },
  { fact: "an upload field is { type: 'image' | 'file', storage } and storage.put answers the url the record saves", recipe: /put\(file, \{ field, tenant \}\) => Promise<string>/, guide: /What `put` answers is what the record saves/, boost: "type: 'image'" },
  { fact: 'uploads are stored only after the rest of the form passes, so a refused save leaves no file', recipe: /stored only after the rest of the form\s+passes/, guide: /A refused save leaves nothing in\s+the bucket/, boost: 'storage' },
  { fact: 'pages are definePages from @rsc-kit/press/pages, built from defineBlock blocks, served by one [...path] catch-all', recipe: /definePages\(\{ blocks/, guide: /`@rsc-kit\/press\/pages` - `definePages`/, boost: 'definePages' },
  { fact: 'a pages catch-all needs site.middleware beside it, or a missing page answers 200 under its shell', recipe: /export default site\.middleware/, guide: /export default site\.middleware/, boost: 'site.middleware' },
  { fact: 'a pages source list() must honour filters: { slug }', recipe: /MUST honour it/, guide: /it is asked for `filters: \{ slug \}`, and\s+must answer/, boost: 'filters: { slug }' },
  { fact: 'cache() with { key, revalidate, tags } keeps answers across requests, and changed(tag) makes the next ask miss', recipe: /cache\(fn, \{ key, revalidate, tags \}\)/, guide: /the next ask misses at once/, boost: 'installCacheStore' },
  { fact: "a press page is kept between requests and a panel save calls changed('press:pages')", recipe: /A save in the panel calls changed\('press:pages'\)/, guide: /at once after `changed\('press:pages'\)`/, boost: "changed('press:pages')" },
  { fact: 'the admin theme is Light, Dark or System, System by default, and the root <html> needs suppressHydrationWarning', recipe: /suppressHydrationWarning/, guide: /suppressHydrationWarning/, boost: 'suppressHydrationWarning' },
  { fact: 'a route.ts POST/PUT/PATCH/DELETE from another site is 403 by Sec-Fetch-Site or Origin, with no token; trustedOrigins names exceptions', recipe: /answered 403\s+before the handler runs/, guide: /answered \*\*403\*\* before your handler runs/, boost: 'trustedOrigins' },
  { fact: 'export const revalidate = N lets a shared cache keep a page rendered per request, when it read nothing of the visitor, and its backend is called as nobody', recipe: /calls its backend as nobody/, guide: /calls its backend as nobody/, boost: 'export const revalidate' },
  { fact: 'a public revalidate page also sends CDN-Cache-Control with the same lifetimes, which Homeport\'s edge caches on and strips', recipe: /CDN-Cache-Control: max-age=60/, guide: /rsc-kit sends `CDN-Cache-Control`/, boost: 'CDN-Cache-Control' },
  { fact: 'changed(tag) calls the purge installed with installPurge, after the answer; homeportPurge is the default where HOMEPORT_PURGE_URL is set, and backends purge their own changes', recipe: /installPurge\(async \(\{ tags \}\) =>/, guide: /`purge\(\{ tags, paths, all \}\)` sends\s+one yourself/, boost: 'HOMEPORT_PURGE_URL' },
  { fact: 'the host keeps a public revalidate page itself, serves it stale past revalidate while one render replaces it, and changed(tag) makes it render on every instance', recipe: /The host also keeps the page itself/, guide: /\*\*`changed\(tag\)` is seen at once, on every instance\.\*\*/, boost: 'X-RSC-Kit: cached' },
  { fact: "defineBlueprint({ actions }) draws a form from what a Laravel or Go function takes, with no schema, and the backend does every check", recipe: /A BACKEND, WITH NO SCHEMA/, guide: /the form needs no schema of its own/, boost: "actions: { create: contactSend }" },
  { fact: "rsc-kit make:form writes a public form from a backend action", recipe: /rsc-kit make:form contactSend/, guide: /rsc-kit make:form contactSend/, boost: "make:form" },
]

describe('what agents are told', () => {
  for (const { fact, recipe, guide } of FACTS) {
    test(fact, () => {
      expect(recipes, `how_to does not say it: ${recipe}`).toMatch(recipe)
      expect(guides, `no guide says it: ${guide}`).toMatch(guide)
    })
  }
})

describe('Boost is decided for every fact', () => {
  test('each one names what the Boost skill says, or says why Laravel apps never meet it', () => {
    for (const { fact, boost, why } of FACTS) {
      expect(boost !== null || (why ?? '').length > 10, `FACTS needs a boost needle, or a why: ${fact}`).toBe(true)
    }
  })

  // The skill lives in rsc-kit/laravel, and describes a feature only once it is
  // released, so this cannot run in CI between a merge and a release. Run it
  // when the Boost PR has merged:
  //
  //   RSC_BOOST=~/Herd/lara-bun/resources/boost/skills/laravel-rsc-development/SKILL.md bun test coverage
  const skill = process.env.RSC_BOOST
  const checkSkill = skill ? test : test.skip

  checkSkill('and the skill at RSC_BOOST says all of it', () => {
    const text = readFileSync(skill!.replace(/^~/, process.env.HOME ?? '~'), 'utf-8').replace(/\s+/g, ' ')

    for (const { fact, boost } of FACTS) {
      if (boost !== null) expect(text, `the Boost skill does not say it: ${fact}`).toContain(boost)
    }
  })
})

describe('every public entry point is written down somewhere', () => {
  const exported = Object.keys(
    (JSON.parse(readFileSync(join(REPO, 'packages/core/package.json'), 'utf-8')) as { exports: Record<string, unknown> }).exports,
  ).filter((key) => key !== '.' && !key.endsWith('package.json'))

  // Entry points no recipe or guide names today. A ratchet: it can only get
  // shorter. A new entry point must be named in a guide or a recipe, or be
  // added here with a reason it is plumbing - and naming one of these removes
  // it, which the second test insists on.
  const PLUMBING = new Set([
    './build', './runtime', './client', './host-calls', './routing', './headers', './export', './files',
    './RedirectBoundary', './conformance', './typegen', './embed', './form-encoding', './useField', './openapi',
  ])

  const named = (key: string) => {
    const name = `@rsc-kit/core/${key.slice(2)}`

    return recipes.includes(name) || guides.includes(name)
  }

  test('a new one is named in a guide or a recipe', () => {
    const unnamed = exported.filter((key) => !named(key) && !PLUMBING.has(key))

    expect(unnamed, 'name these in a guide or a recipe, or list them as plumbing here').toEqual([])
  })

  test('and one that has been named leaves the list', () => {
    const stale = [...PLUMBING].filter((key) => named(key))

    expect(stale, 'now documented: remove from PLUMBING').toEqual([])
  })
})
