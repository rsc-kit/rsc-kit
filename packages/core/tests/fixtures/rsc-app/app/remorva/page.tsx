import type { Metadata } from '../../../../../src/metadata'

// Verbatim from a Next app being ported. If this typechecks and renders, the
// port carries its metadata across unchanged.
export const metadata: Metadata = {
  title: "Remorva — Restore your damaged family photos",
  description:
    "Bring damaged family photos back to life. Tears, creases, stains, and fading repaired in about a minute — with black & white photos restored in realistic, natural color.",
  metadataBase: new URL("https://remorva.com"),
  openGraph: {
    title: "Remorva — Photo restoration, done in a minute",
    description:
      "Repair tears, creases, stains, and fading — and bring black & white photos back in realistic color. Private, print-ready, yours forever.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Remorva — Photo restoration, done in a minute",
    description: "Repair damaged family photos and restore them in color.",
  },
}

export default function RemorvaPage() {
  return <main>remorva</main>
}
