export async function titled({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return { title: `Memo ${id}` }
}
