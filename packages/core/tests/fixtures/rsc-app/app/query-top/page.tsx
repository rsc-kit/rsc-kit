import { Suspense } from "react";
import { QueryReader } from "../../QueryReader";

// The developer's own <Suspense> as the FIRST thing in the segment, on a page
// with a per-request hole - the shape of a layout that wraps its auth
// trigger. Stored as a shell and resumed per request; on the resume React
// leaves server components out of the component stack, so this Suspense
// sits directly under the engine's segment boundary. It is still the
// developer's, and the resume must not report it as a loading.tsx catching
// the whole segment.
// The per-request read first, then the query: the build's probe never
// answers the host, so this postpones here and the page is a shell; the
// resume answers it, reaches the query read, and the developer's boundary
// above catches that. The shape of a layout's auth trigger.
async function PerRequestThenQuery() {
  const data = (await (globalThis as any).rpc("slowData", 10)) as { value: string };

  return (
    <>
      <p id="per-request">rendered per request: {data.value}</p>
      <QueryReader />
    </>
  );
}

export default function QueryTopPage() {
  return (
    <Suspense fallback={<p id="query-top-fallback">reading…</p>}>
      <PerRequestThenQuery />
    </Suspense>
  );
}
