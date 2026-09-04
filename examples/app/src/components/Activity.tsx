// A server component that takes its time. Nothing about it reaches the browser.
export async function Activity() {
  const events = await rpc<{ at: string; what: string }[]>('activity')

  return (
    <ul className="activity">
      {events.map((event) => (
        <li key={event.at}>
          <time>{event.at}</time> {event.what}
        </li>
      ))}
    </ul>
  )
}
