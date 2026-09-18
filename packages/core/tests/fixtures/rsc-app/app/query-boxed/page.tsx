import { Suspense } from "react";
import { QueryReader } from "../../QueryReader";

// The boundary is where the read is: a hole, and the rest is stored.
export default function QueryBoxedPage() {
  return (
    <main>
      <h1>Search</h1>
      <Suspense fallback={<p id="query-fallback">reading…</p>}>
        <QueryReader />
      </Suspense>
    </main>
  );
}
