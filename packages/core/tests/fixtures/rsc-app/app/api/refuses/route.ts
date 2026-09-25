// Refuses without reading anything the probe can see - a check against
// something outside the request. Its 403 is not an answer to keep.
export async function GET() {
  return new Response('Forbidden', { status: 403 })
}
