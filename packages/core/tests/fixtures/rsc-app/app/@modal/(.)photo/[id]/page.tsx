// Interceptor: renders in the @modal slot when navigating to /photo/[id]
// from within the app, receiving the target route's params.
export default async function PhotoModal({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params

  return <div id="photo-modal">Modal for photo {id}</div>
}
