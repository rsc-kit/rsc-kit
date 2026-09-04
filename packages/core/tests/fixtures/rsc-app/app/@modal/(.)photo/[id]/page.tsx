// Interceptor: renders in the @modal slot when navigating to /photo/[id]
// from within the app, receiving the target route's params.
export default function PhotoModal({ id }: { id?: string }) {
  return <div id="photo-modal">Modal for photo {id}</div>
}
