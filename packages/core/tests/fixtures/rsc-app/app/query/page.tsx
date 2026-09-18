import { QueryReader } from "../../QueryReader";

// No boundary of its own: the read is caught by the root loading.tsx, and
// that fallback is the whole page at first paint.
export default function QueryPage() {
  return (
    <main>
      <h1>Search</h1>
      <QueryReader />
    </main>
  );
}
