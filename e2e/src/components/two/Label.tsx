'use client'

// A different component with the same name - a wrapper named after the
// primitive it wraps, which is what shadcn writes.
export function Label({ children }: { children: React.ReactNode }) {
  return <i data-label="two">{children}</i>
}
