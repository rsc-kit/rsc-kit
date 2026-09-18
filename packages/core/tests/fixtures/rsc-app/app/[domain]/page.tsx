// A tenant's home. The segment is the host: `acme.fixture.test/` binds
// domain = "acme", a custom domain `acme.com/` binds domain = "acme.com".
// The listed ones are stored at build, one copy per host.
export async function generateStaticParams() {
  return [{ domain: 'acme' }, { domain: 'acme.com' }]
}

export default async function TenantHome({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params

  return <main id="tenant">Tenant {domain}</main>
}
