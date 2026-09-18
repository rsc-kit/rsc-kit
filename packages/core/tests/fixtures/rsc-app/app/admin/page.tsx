// Reached two ways: fixture.test/admin by path, and admin.fixture.test/ by
// host - the subdomain of an own host is the same segment.
export default function Admin() {
  return <main id="admin">Admin</main>
}
