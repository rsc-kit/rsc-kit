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
  evidence,
  children,
}: {
  n: string
  label: string
  title: string
  evidence?: React.ReactNode
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
      {evidence && (
        <figure className="evidence">
          <pre>
            <code>{evidence}</code>
          </pre>
        </figure>
      )}
    </section>
  )
}

/** Hand-marked emphasis inside an evidence block. No highlighter, no runtime. */
const K = ({ children }: { children: React.ReactNode }) => <b className="k">{children}</b>
const S = ({ children }: { children: React.ReactNode }) => <i className="s">{children}</i>
const C = ({ children }: { children: React.ReactNode }) => <span className="c">{children}</span>
const Bad = ({ children }: { children: React.ReactNode }) => <span className="bad">{children}</span>
const Good = ({ children }: { children: React.ReactNode }) => <span className="good">{children}</span>

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
        <p className="eyebrow">React Server Components as a Vite plugin · v0.17</p>
        <h1>
          The build tells you <em>the truth.</em>
        </h1>
        <p className="lede">
          Every route is rendered at build time. What is not static says why. What cannot be right is refused,
          with the fix named. Nothing ships JavaScript until you write <code>"use client"</code> — this page never
          did. It is also exactly what an agent reads instead of guessing.
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

      <Section
        n="01"
        label="Static"
        title="Nothing is dynamic by declaration"
        evidence={
          <>
            <Good>○</Good>  /pricing               84 kB{'\n'}
            <span className="warn">◐</span>  /account               85 kB{'\n'}
            {'   '}<C>dynamic — called cookies()</C>{'\n'}
            <Bad>✗</Bad>  /orders{'\n'}
            {'   '}<Bad>reads the request before anything can paint.</Bad>{'\n'}
            {'   '}<Bad>Add a loading.tsx beside it, or a &lt;Suspense&gt; above.</Bad>
          </>
        }
      >
        <p>
          There is no <code>export const dynamic</code>. A page is frozen at build time unless it reads the request,
          and the build prints which read did it. A page that blocks above every <code>&lt;Suspense&gt;</code> is
          refused with the fix named, not stored blank. All of it lands in a <code>build-report.json</code> a CI
          step can assert on.
        </p>
        <a href={`${DOCS}/guides/static-generation`}>Static generation →</a>
      </Section>

      <Section
        n="02"
        label="Agent-native"
        title="The structure is exposed, and the guardrails are real"
        evidence={
          <>
            <C>&gt; list_routes</C>{'\n'}
            15 static, 5 partial prerender, 2 dynamic{'\n'}
            <C>(from the last build, just now)</C>{'\n'}
            {'\n'}
            /locale   86 kB  — a stored shell, the rest per request{'\n'}
            {'    '}dynamic — called cookies(), headers(){'\n'}
            {'\n'}
            actions: 8, 6 built from an action client{'\n'}
            <span className="warn">2 run NO middleware:</span> addToTotal, placeOrder{'\n'}
            {'\n'}
            <C>&gt; how_to({'{'} topic: <S>'forms'</S> {'}'})</C>{'\n'}
            <C>&gt; read_guide({'{'} slug: <S>'server-actions'</S> {'}'})</C>
          </>
        }
      >
        <p>
          Not a framework that builds your app for you — one an agent can build correctly on. The build refuses
          what cannot be right. Every project ships an <code>AGENTS.md</code> for the rules that compile either
          way, a <code>.mcp.json</code> to a server that answers from the last build with every guide bundled, and
          tests that hit the deployed handler with no port and no browser. <code>bun run check</code> is the whole
          loop.
        </p>
        <a href={`${DOCS}/guides/mcp`}>Working with an agent →</a>
      </Section>

      <Section
        n="03"
        label="Actions"
        title="Failures come back, not thrown across the wire"
        evidence={
          <>
            <K>export const</K> createPost = client{'\n'}
            {'  '}.input(schema){'\n'}
            {'  '}.handler(<K>async</K> ({'{'} input, ctx, fieldErrors {'}'}) =&gt; {'{'}{'\n'}
            {'    '}<K>if</K> (<K>await</K> slugTaken(input.slug)){'\n'}
            {'      '}<K>return</K> fieldErrors({'{'} slug: <S>'Already taken'</S> {'}'}){'\n'}
            {'    '}revalidate(<S>'posts'</S>){'\n'}
            {'    '}<K>return</K> save(input, ctx.user){'\n'}
            {'  '}{'}'}){'\n'}
            <C>{'// → { data } | { validationErrors } | { serverError }'}</C>
          </>
        }
      >
        <p>
          <code>createActionClient()</code> chains middleware with typed <code>ctx</code>, validates with any Standard
          Schema, and <em>returns</em> what went wrong — React strips a thrown message in production, and the field
          it named goes with it. <code>revalidate('posts')</code> re-renders one named section and sends it back with
          the action's own answer: one request. The build lists every action not built this way.
        </p>
        <a href={`${DOCS}/guides/server-actions`}>Server actions →</a>
      </Section>

      <Section
        n="04"
        label="Forms"
        title="Works before hydration, and after"
        evidence={
          <>
            &lt;<K>Form</K> action={'{'}createPost{'}'} schema={'{'}schema{'}'}&gt;{'\n'}
            {'  '}{'{'}({'{'} pending, error {'}'}) =&gt; ({'\n'}
            {'    '}&lt;&gt;{'\n'}
            {'      '}&lt;input name=<S>"title"</S> /&gt;{'\n'}
            {'      '}{'{'}error(<S>'title'</S>) &amp;&amp; &lt;p&gt;{'{'}error(<S>'title'</S>){'}'}&lt;/p&gt;{'}'}{'\n'}
            {'      '}&lt;button disabled={'{'}pending{'}'}&gt;Save&lt;/button&gt;{'\n'}
            {'    '}&lt;/&gt;{'\n'}
            {'  '}){'}'}{'\n'}
            &lt;/<K>Form</K>&gt;{'\n'}
            <C>{'// a real <form action>: submits with no JS, then upgrades'}</C>
          </>
        }
      >
        <p>
          A real form: it submits without JavaScript, then upgrades. The schema runs in the browser and again in the
          action; field errors land on the field. Uncontrolled by default, <code>field()</code> for a controlled
          binding, <code>useField()</code> for a value read anywhere. shadcn's <code>Field</code> fits as it is.
        </p>
        <a href={`${DOCS}/guides/forms`}>Forms →</a>
      </Section>

      <Section
        n="05"
        label="Types"
        title="Typed all the way to the link"
        evidence={
          <>
            &lt;<K>Link</K> href=<S>"/search"</S> search={'{{'} q: <S>'shoes'</S>, page: 2 {'}}'} /&gt;{'\n'}
            {'\n'}
            &lt;<K>Link</K> href=<S>"/search"</S> search={'{{'} page: <Bad>'2'</Bad> {'}}'} /&gt;{'\n'}
            <Bad>{'                              ~~~'}</Bad>{'\n'}
            <C>Type 'string' is not assignable to type 'number'.</C>{'\n'}
            {'\n'}
            &lt;<K>Link</K> href=<Bad>"/serach"</Bad> /&gt;{'\n'}
            <Bad>{'           ~~~~~~~~~'}</Bad>{'\n'}
            <C>'/serach' is not a route this app answers.</C>
          </>
        }
      >
        <p>
          An href that no route answers stops compiling. Export a <code>searchParams</code> schema beside a page and
          the values arrive parsed — and the same schema types every <code>&lt;Link search&gt;</code> to it. Bad
          params are a 404, a bad query reaches the error boundary, a bad body is a 422.
        </p>
        <a href={`${DOCS}/guides/typed-routes`}>Typed routes →</a>
      </Section>

      <Section
        n="06"
        label="Deploy"
        title="Where it runs is one string"
        evidence={
          <>
            nitro({'{'} preset: <S>'bun'</S> {'}'}){'\n'}
            nitro({'{'} preset: <S>'node'</S> {'}'}){'\n'}
            nitro({'{'} preset: <S>'cloudflare_module'</S> {'}'})   <C>← this page</C>{'\n'}
            nitro({'{'} preset: <S>'vercel'</S> {'}'}){'\n'}
            nitro({'{'} preset: <S>'netlify'</S> {'}'}){'\n'}
            nitro({'{'} preset: <S>'deno_deploy'</S> {'}'}){'\n'}
            <C>{'// same route tree, same build output, same report'}</C>
          </>
        }
      >
        <p>
          There is no server file. Nitro builds one around the route tree, so the target is a preset, not an adapter
          package to wait for. Or <code>bun build --compile</code> into one binary. Tailwind, PostCSS and any Vite
          plugin work the way they do in any Vite app.
        </p>
        <a href={`${DOCS}/hosts/deployment`}>Deployment →</a>
      </Section>

      <Section n="07" label="Honest" title="Where it stands">
        <p>
          Version 0.16, and the API is not frozen. For a content site with forms on Bun or Workers, it is ready
          today. For a large team's product, Next is still the safe answer, and this page will say so until it is
          not.
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
