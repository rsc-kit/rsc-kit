// Blocks with no boundary of its own, so the root loading.tsx catches it. The
// page is still stored — which is the problem the warning exists for: it looks
// exactly like a page whose boundary is in the right place.
export default async function InheritedPage() {
  const data = (await (globalThis as any).rpc('slowData', 3000)) as { value: string }

  return <p id="inherited">{data.value}</p>
}
