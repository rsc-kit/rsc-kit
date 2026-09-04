"""Convert the RSC docs pages from JSX to MDX.

The pages are regular enough for this: every one is a flat sequence of
headings, paragraphs, lists and CodeBlocks with the same className vocabulary.
Anything this cannot recognise is left in place, so it shows up as literal JSX
in the output rather than being silently dropped.
"""
import re, sys, pathlib, html, textwrap


def code_blocks(s):
    """<CodeBlock language=".." title="..">{`...`}</CodeBlock> → a fence."""
    def repl(m):
        attrs, body = m.group(1), m.group(2)
        lang = (re.search(r'language="([^"]+)"', attrs) or [None, 'text'])[1]
        title = re.search(r'title="([^"]+)"', attrs)
        meta = f' title="{title.group(1)}"' if title else ''
        body = body.replace('\\`', '`').replace('\\$', '$')
        return f'\n```{lang}{meta}\n{body.strip()}\n```\n'

    return re.sub(r'<CodeBlock([^>]*)>\s*\{`(.*?)`\}\s*</CodeBlock>', repl, s, flags=re.S)


def pre_blocks(s):
    """<pre>{`…`}</pre> → a plain fence.

    The pages use these for trees and build output — text that is not a
    language, and must not be reflowed into a paragraph.
    """
    return re.sub(
        r'<pre[^>]*>\s*\{`(.*?)`\}\s*</pre>',
        lambda m: f'\n```text\n{m.group(1).strip()}\n```\n',
        s,
        flags=re.S,
    )


def inline(s):
    # A code span whose content is a braced JSX literal — `{`<Suspense>`}` —
    # is text about markup. Wrapping the braces in backticks as well produces
    # nested backticks, and MDX then reads the tag as a component to render.
    s = re.sub(
        r'<span className="doc-code">\{[`\'"](.*?)[`\'"]\}</span>',
        lambda m: f'`{m.group(1)}`',
        s,
        flags=re.S,
    )
    s = re.sub(r'<span className="doc-code">(.*?)</span>', lambda m: f'`{m.group(1)}`', s, flags=re.S)
    s = re.sub(r'<strong[^>]*>(.*?)</strong>', lambda m: f'**{m.group(1).strip()}**', s, flags=re.S)
    s = re.sub(r'<em[^>]*>(.*?)</em>', lambda m: f'*{m.group(1).strip()}*', s, flags=re.S)
    # A <code> block spanning lines is a block, and inline backticks do not
    # span lines: they never close, and whatever markup the text is *about*
    # then reads as a tag.
    def code_span(m):
        text = m.group(1)

        if '\n' in text.strip():
            plain = re.sub(r"\{['\"`](.*?)['\"`]\}", r'\1', textwrap.dedent(text).strip(), flags=re.S)

            return f'\n\n```text\n{plain}\n```\n\n'

        # Braces stripped here rather than left for the sweep, which would
        # wrap them in backticks *inside* these ones and break the span.
        return '`' + re.sub(r"\{['\"`](.*?)['\"`]\}", r'\1', text.strip(), flags=re.S) + '`'

    s = re.sub(r'<code[^>]*>(.*?)</code>', code_span, s, flags=re.S)
    # Every other span is decoration — a colour on a word — and carries no
    # meaning worth keeping once the page is prose.
    for _ in range(4):
        s = re.sub(r'<span[^>]*>(.*?)</span>', lambda m: m.group(1), s, flags=re.S)
    # Links: /docs/x becomes /x in the new site.
    def link(m):
        href, text = m.group(1), re.sub(r'\s+', ' ', m.group(2)).strip()
        href = href.replace('/docs/', '/')
        return f'[{text}]({href})'
    s = re.sub(r'<Link\s+href="([^"]+)"[^>]*>(.*?)</Link>', link, s, flags=re.S)
    s = re.sub(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>', link, s, flags=re.S)
    return s


def mapped_lists(s):
    """`{[ 'a', 'b' ].map(...)}` → a list.

    The one dynamic construct these pages use: an array of strings rendered as
    numbered steps or ticks. Left alone it survives conversion as JavaScript in
    the middle of the prose, which MDX then fails to parse — loudly, at least.
    """
    def one(m):
        items = re.findall(r"'((?:[^'\\]|\\.)*)'", m.group(1))
        items = [i.replace("\\'", "'") for i in items]
        numbered = '{i + 1}' in m.group(2)

        if not items:
            return m.group(0)

        return '\n\n' + '\n'.join(
            f'{n}. {clean(text)}' if numbered else f'- {clean(text)}'
            for n, text in enumerate(items, 1)
        ) + '\n\n'

    return re.sub(r'\{\[(.*?)\]\.map\((.*?)\)\}', one, s, flags=re.S)


def tables(s):
    """<table> with th/td rows → a markdown table.

    The pages carry real tables — option names against what they do — and they
    are the one structure that cannot survive being flattened into paragraphs.
    """
    def one(m):
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', m.group(1), re.S)
        out, header_done = [], False

        for row in rows:
            cells = re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.S)

            if not cells:
                continue

            # A cell is one line of a table, so its content cannot break onto
            # another — and a type in one is markup to MDX.
            rendered = []

            for c in cells:
                text = clean(c).replace('|', '\\|')
                rendered.append(text if '`' in text else as_code_if_markup(text))

            out.append('| ' + ' | '.join(rendered) + ' |')

            if not header_done:
                out.append('|' + '|'.join([' --- '] * len(cells)) + '|')
                header_done = True

        return '\n\n' + '\n'.join(out) + '\n\n'

    return re.sub(r'<table[^>]*>(.*?)</table>', one, s, flags=re.S)


def blocks(s):
    s = re.sub(r'<h2[^>]*>(.*?)</h2>', lambda m: f'\n## {clean(m.group(1))}\n', s, flags=re.S)
    s = re.sub(r'<h3[^>]*>(.*?)</h3>', lambda m: f'\n### {clean(m.group(1))}\n', s, flags=re.S)
    s = re.sub(r'<p[^>]*>(.*?)</p>', lambda m: f'\n{clean(m.group(1))}\n', s, flags=re.S)
    s = re.sub(r'<li[^>]*>(.*?)</li>', lambda m: f'- {clean(m.group(1))}', s, flags=re.S)
    s = re.sub(r'</?(ul|ol|div|section)[^>]*>', '', s)
    s = re.sub(r'<hr[^>]*/?>', '\n---\n', s)
    s = re.sub(r'<br\s*/?>', '\n', s)
    return s


def as_code_if_markup(text):
    """Anything with angle brackets or braces in it has to be code in MDX.

    `<head>` in prose is a tag MDX will try to render, and `Record<string,
    string[]>` in a table cell is the same problem wearing a type. Both were
    plain text on the page they came from.
    """
    return f'`{text}`' if re.search(r'[<>{}]', text) else text


def clean(text):
    text = re.sub(r"\{'(.*?)'\}", lambda m: as_code_if_markup(m.group(1)), text, flags=re.S)
    text = re.sub(r'\{"(.*?)"\}', lambda m: as_code_if_markup(m.group(1)), text, flags=re.S)
    text = re.sub(r'\{`(.*?)`\}', lambda m: as_code_if_markup(m.group(1)), text, flags=re.S)
    text = html.unescape(text)
    return re.sub(r'\s+', ' ', text).strip()


def convert(path, title, description, order):
    src = pathlib.Path(path).read_text()

    body = src[src.index('return ('):]
    body = body[body.index('(') + 1:]
    body = body.rsplit(');', 1)[0]

    body = code_blocks(body)
    body = pre_blocks(body)

    # Fences are set aside before anything else runs. A sample containing
    # `return <h1>About</h1>` is markup to the page and text to the reader, and
    # a transform that cannot tell the difference rewrites the sample — which
    # is how `return <h1>About Us</h1>` became `return ;`.
    fences = []

    def stash(m):
        fences.append(m.group(0))
        return f'\x00FENCE{len(fences) - 1}\x00'

    body = re.sub(r'```.*?```', stash, body, flags=re.S)

    body = inline(body)
    body = mapped_lists(body)
    body = tables(body)

    heading = re.search(r'<h1[^>]*>(.*?)</h1>', body, re.S)
    body = re.sub(r'<h1[^>]*>.*?</h1>', '', body, flags=re.S)

    body = blocks(body)

    # A last sweep for braced literals in text that never passed through a
    # paragraph — inside a bare div, say. MDX evaluates `{'<Suspense>'}` as an
    # expression and renders the right characters, so these were invisible on
    # the page and only a problem for anyone editing the file afterwards.
    def literal(m):
        text = m.group(1)

        # Inline code cannot span lines, so a multi-line literal has to be a
        # fence — as backticks it never closes, and the markup inside it
        # becomes a tag MDX then tries to render.
        if '\n' in text:
            return f'\n\n```text\n{textwrap.dedent(text).strip()}\n```\n\n'

        return as_code_if_markup(text.strip())

    for pattern in (r"\{'(.*?)'\}", r'\{"(.*?)"\}', r'\{`(.*?)`\}'):
        body = re.sub(pattern, literal, body, flags=re.S)

    for i, fence in enumerate(fences):
        body = body.replace(f'\x00FENCE{i}\x00', fence)

    # Outside a fence, leading whitespace is JSX indentation left over from
    # the source. MDX has no indented code blocks — unlike markdown — so an
    # indented line is simply a paragraph, and one that looked safe was not.
    lines, fenced, out = body.split('\n'), False, []

    for line in lines:
        if line.strip().startswith('```') or '\x00FENCE' in line:
            fenced = not fenced if line.strip().startswith('```') else fenced
            out.append(line.rstrip())
            continue

        out.append(line.rstrip() if fenced else line.strip())

    body = '\n'.join(out)
    body = re.sub(r'\n{3,}', '\n\n', body).strip()

    front = (
        '---\n'
        f'title: {title or clean(heading.group(1)) if heading else title}\n'
        f'description: {description}\n'
        'sidebar:\n'
        f'  order: {order}\n'
        '---\n\n'
    )
    return front + body + '\n'


if __name__ == '__main__':
    src, out, title, desc, order = sys.argv[1:6]
    pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(out).write_text(convert(src, title, desc, order))
    print('wrote', out)
