/**
 * The landing page, built with the framework it describes.
 *
 * No client component anywhere on it — plain anchors, CSS for motion, the
 * viewer's colour scheme for theme — so the build stores it without the
 * runtime. The ledger in the hero is real build output, and the highlighted
 * row is this page's own.
 */

const DOCS = 'https://docs.rsc-kit.dev'
const REPO = 'https://github.com/rsc-kit/rsc-kit'

type Row = { mark: '○' | '◐' | 'ƒ' | '✗' | '⚠'; url: string; size?: string; note?: string; self?: boolean }

// From the example app's build and this site's, verbatim.
const LEDGER: Row[] = [
  { mark: '○', url: '/', size: 'no js', note: 'no client components, so ships no javascript', self: true },
  { mark: '○', url: '/orders', size: '86 kB' },
  { mark: '◐', url: '/locale', size: '86 kB', note: 'dynamic — called cookies(), headers()' },
  { mark: '◐', url: '/dashboard', size: '85 kB', note: 'data took longer than the build budget' },
  { mark: '◐', url: '/posts/_slug_', size: '85 kB', note: 'one shell for every url — add generateStaticParams to store each' },
  { mark: 'ƒ', url: '/guarded/api/secret', note: 'guarded by middleware' },
  {
    mark: '✗',
    url: '/account',
    note: 'reads the request before anything can paint. Add a loading.tsx beside it, or put a <Suspense> above the waiting, and it has a skeleton to store.',
  },
]

const MARKS: Record<Row['mark'], string> = {
  '○': 'static',
  '◐': 'partial',
  'ƒ': 'dynamic',
  '✗': 'refused',
  '⚠': 'warning',
}

function Ledger() {
  return (
    <figure className="ledger" aria-label="Build output">
      <figcaption>
        <span className="cmd">$ vite build</span>
      </figcaption>
      <ol>
        {LEDGER.map((row) => (
          <li key={row.url} className={`row mark-${MARKS[row.mark]}${row.self ? ' self' : ''}`}>
            <span className="mark" aria-label={MARKS[row.mark]}>
              {row.mark}
            </span>
            <span className="url">{row.url}</span>
            <span className="size">{row.size ?? ''}</span>
            {row.note && <span className="note">{row.note}</span>}
            {row.self && <span className="you">this page</span>}
          </li>
        ))}
      </ol>
      <div className="audit">
        <span className="mark" aria-label="warning">
          ⚠
        </span>
        <span>
          2 actions run no middleware: <b>addToTotal, placeOrder</b> (src/actions.ts)
          <br />
          Nothing checks who calls them. Fine for a public one; otherwise build it from an action client, so the
          check cannot be forgotten.
        </span>
      </div>
    </figure>
  )
}

function Section({
  n,
  label,
  title,
  children,
}: {
  n: string
  label: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="spec" id={label.toLowerCase().replace(/\s+/g, '-')}>
      <div className="spec-label">
        <span className="n">{n}</span>
        <span className="lbl">{label}</span>
      </div>
      <div className="spec-body">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  )
}

export default function Page() {
  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="/">
          rsc-kit
        </a>
        <nav aria-label="Primary">
          <a href={DOCS}>Docs</a>
          <a href={`${DOCS}/coming-from-next`}>From Next.js</a>
          <a href={REPO}>GitHub</a>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">React Server Components as a Vite plugin · v0.16</p>
        <h1>
          The build tells you <em>the truth.</em>
        </h1>
        <p className="lede">
          Every route is rendered at build time. What is not static says why. What cannot be right is refused,
          with the fix named. A page with nothing to hydrate ships no JavaScript at all — this one, for instance.
        </p>
        <div className="cta">
          <pre className="install">
            <code>bun create rsc-kit@latest my-app</code>
          </pre>
          <a className="button" href={`${DOCS}/quick-start`}>
            Quick start
          </a>
        </div>
      </section>

      <Ledger />

      <div className="figures" aria-label="Sizes">
        <div>
          <b>6 kB</b>
          <span>gzipped on top of React</span>
        </div>
        <div>
          <b>0 kB</b>
          <span>on a page with nothing to hydrate</span>
        </div>
        <div>
          <b>1 string</b>
          <span>to move from a container to Workers</span>
        </div>
      </div>

      <Section n="01" label="Static" title="Nothing is dynamic by declaration">
        <p>
          There is no <code>export const dynamic</code>. A page is frozen at build time unless it reads the request —{' '}
          <code>cookies()</code>, <code>headers()</code>, <code>searchParams</code>,{' '}
          <code>await connection()</code> — and the build prints which read did it. A page that blocks above every{' '}
          <code>&lt;Suspense&gt;</code> is refused rather than stored blank. The whole decision is on one line you can
          read, and in a <code>build-report.json</code> a CI step can assert on.
        </p>
        <a href={`${DOCS}/guides/static-generation`}>Static generation →</a>
      </Section>

      <Section n="02" label="Actions" title="Failures come back, not thrown across the wire">
        <p>
          <code>createActionClient()</code> chains middleware with typed <code>ctx</code>, validates input with any
          Standard Schema, and <em>returns</em> what went wrong — <code>{'{ validationErrors }'}</code>,{' '}
          <code>{'{ serverError }'}</code> — because React strips a thrown message in production and the field it
          named goes with it. Reads go out as <code>GET</code>. <code>revalidate('orders')</code> re-renders one
          named section and sends it back with the action's own answer: one request, and the half-typed input on the
          other side of the page is still typed. The build lists every action not built this way, because nothing
          checks who calls those.
        </p>
        <a href={`${DOCS}/guides/server-actions`}>Server actions →</a>
      </Section>

      <Section n="03" label="Forms" title="Works before hydration, and after">
        <p>
          <code>&lt;Form action={'{createPost}'} schema={'{schema}'}&gt;</code> is a real form: it submits without
          JavaScript, then upgrades. The schema runs in the browser and again in the action. Field errors land on the
          field. Uncontrolled by default; <code>field()</code> when you want a controlled binding, <code>useField()</code>{' '}
          for a value read anywhere with no whole-form re-render. shadcn's <code>Field</code> components fit as they
          are.
        </p>
        <a href={`${DOCS}/guides/forms`}>Forms →</a>
      </Section>

      <Section n="04" label="Types" title="Typed all the way to the link">
        <p>
          <code>{'<Link href="/posts/${slug}">'}</code> stops compiling when the route does not exist. Export a{' '}
          <code>searchParams</code> schema beside a page and the values arrive parsed — and the same schema types
          every <code>{'<Link search={{ page: 2 }}>'}</code> to it. <code>page: '2'</code> does not compile. Bad params
          are a 404; a bad query reaches the error boundary; a bad body is a 422.
        </p>
        <a href={`${DOCS}/guides/typed-routes`}>Typed routes →</a>
      </Section>

      <Section n="05" label="Deploy" title="Where it runs is one string">
        <p>
          There is no server file. Nitro builds one around the route tree, so Bun, Node, Cloudflare Workers, Vercel,
          Netlify and Deno are a preset — <code>nitro({'{ preset: "cloudflare_module" }'})</code> — not an adapter
          package to wait for. Or <code>bun build --compile</code> into one binary. Tailwind, PostCSS and any Vite
          plugin work the way they do in any Vite app.
        </p>
        <a href={`${DOCS}/hosts/deployment`}>Deployment →</a>
      </Section>

      <Section n="06" label="Agent-native" title="The structure is exposed, and the guardrails are real">
        <p>
          Not a framework that builds your app for you — one an agent can build correctly on. The build refuses what
          cannot be right and names the fix. Every project ships an <code>AGENTS.md</code> for the rules that differ
          from Next and compile either way, and a <code>.mcp.json</code> connecting a server that answers from the
          last build — which routes froze, why one is dynamic, what a page costs — with every guide bundled at the
          installed version. Tests hit the deployed handler with no port and no browser. <code>bun run check</code> is
          the whole loop, and none of it needs the app running.
        </p>
        <a href={`${DOCS}/guides/mcp`}>Working with an agent →</a>
      </Section>

      <Section n="07" label="Honest" title="Where it stands">
        <p>
          Version 0.16. It sits on <code>@vitejs/plugin-rsc</code> and Nitro 3, both still experimental, and the API
          is not frozen. There is no auth-library integration and no i18n story yet. For a content site with forms on
          Bun or Workers, it is ready today. For a large team's product, Next is still the safe answer, and this page
          will say so until it is not.
        </p>
        <a href={`${DOCS}/coming-from-next`}>Coming from Next.js →</a>
      </Section>

      <footer>
        <div>
          <a href={DOCS}>Documentation</a>
          <a href={`${DOCS}/llms.txt`}>llms.txt</a>
          <a href={REPO}>GitHub</a>
          <a href="https://www.npmjs.com/package/@rsc-kit/core">npm</a>
        </div>
        <p>MIT.</p>
      </footer>
    </main>
  )
}
