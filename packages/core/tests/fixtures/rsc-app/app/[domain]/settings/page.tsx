export default async function TenantSettings({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params

  return <main id="tenant-settings">Settings for {domain}</main>
}
