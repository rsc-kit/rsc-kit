// The shop's own 404: a notFound() from any page in the (shop) group, inside the
// shop's layout - its header stays. The root not-found.tsx answers everything else.
export default function ShopNotFound() {
  return (
    <main>
      <h1 id="shop-not-found">Nothing in the shop</h1>
    </main>
  )
}
