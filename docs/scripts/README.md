# The port

These converted the docs from the Laravel app that hosted them — pages written
as React components — into the MDX in `src/content/docs`. They ran once and are
kept because the conversion is worth being able to redo, and because what they
had to special-case is a record of what those pages contained: tables, `<pre>`
trees, arrays mapped into numbered steps, and JSX literals in prose.

    python3 scripts/port.py

They are not part of the build. New pages are written as MDX.
