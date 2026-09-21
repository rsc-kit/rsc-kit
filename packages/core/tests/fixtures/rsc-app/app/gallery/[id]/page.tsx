import { Suspense } from 'react'

// A pattern route with a title read from the params and its own boundary
// inside the page - the shape a product page has. The shell holds the frame
// and the fallback; the resume fills the hole for one id.
export async function generateMetadata({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params

  return { title: `Gallery ${id}`, description: `Picture ${id}`, openGraph: { title: `Gallery ${id}` } }
}

async function Picture({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params

  return <figure id="gallery-picture">Picture {id}</figure>
}

export default function GalleryPage({ params }: { params: Promise<{ id?: string }> }) {
  return (
    <section id="gallery">
      <h1>Gallery</h1>
      <Suspense fallback={<i id="gallery-fallback">loading</i>}>
        <Picture params={params} />
      </Suspense>
    </section>
  )
}
