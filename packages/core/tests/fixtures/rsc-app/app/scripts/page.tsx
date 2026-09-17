// Three ways a script can be put on a page from a server component, to see
// what React 19 does with each before deciding whether a wrapper is needed.
export default function ScriptsPage() {
  return (
    <main>
      {/* 1. external, async — Next's afterInteractive for a src */}
      <script async src="https://www.clarity.ms/tag/abc123" />

      {/* 2. inline — Clarity's actual snippet shape */}
      <script
        id="ms-clarity"
        dangerouslySetInnerHTML={{
          __html: '(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){}})(window,document,"clarity","script","abc123");',
        }}
      />

      {/* 3. the same external one twice, to see if React dedupes */}
      <script async src="https://www.clarity.ms/tag/abc123" />

      <p>content</p>
    </main>
  )
}
