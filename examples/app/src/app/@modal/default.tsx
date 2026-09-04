// What fills the modal slot when nothing is intercepting. Rendering nothing is
// the point: the slot exists on every page, and is empty until a navigation
// puts something in it.
export default function NoModal() {
  return null
}
