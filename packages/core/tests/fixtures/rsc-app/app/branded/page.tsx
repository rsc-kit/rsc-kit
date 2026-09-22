import type { Metadata } from '../../../../../src/metadata'

// Verbatim from a Next app being ported. If this typechecks and renders, the
// port carries its metadata across unchanged.
export const metadata: Metadata = {
  title: "Example — a page with a full share card",
  description:
    "Bring damaged family photos back to life. Tears, creases, stains, and fading repaired in about a minute — with black & white photos restored in realistic, natural color.",
  metadataBase: new URL("https://example.com"),
  openGraph: {
    title: "Example — the same title, for a share card",
    description:
      "Repair tears, creases, stains, and fading — and bring black & white photos back in realistic color. Private, print-ready, yours forever.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Example — the same title, for a share card",
    description: "Repair damaged family photos and restore them in color.",
  },
}

export default function BrandedPage() {
  return <main>branded</main>
}
