import subprocess, sys, pathlib
sys.path.insert(0, '/private/tmp/claude-501/-Users-ramonmalcolm-Herd-lara-bun/6e79eeba-6497-43ae-9d9e-4dff91661df3/scratchpad')
from tsx2mdx import convert

S = pathlib.Path('/Users/ramonmalcolm/Herd/larabun-docs/resources/js/rsc')
D = pathlib.Path('/Users/ramonmalcolm/Herd/rsc-kit/docs/src/content/docs')

PAGES = [
    ('DocsRsc', 'guides/routing', 'Routing', 'File-based routes, layouts, loading states and parallel slots.', 1),
    ('DocsServerActions', 'guides/server-actions', 'Server actions', 'Calling the server from a client component, as an ordinary function.', 2),
    ('DocsForms', 'guides/forms', 'Forms', 'Progressive forms, pending state and validation errors.', 3),
    ('DocsFileUploads', 'guides/file-uploads', 'File uploads', 'Sending files through a server action without encoding them.', 4),
    ('DocsValidation', 'guides/validation', 'Validation', 'Surfacing server-side validation errors in a form.', 5),
    ('DocsAuthorization', 'guides/authorization', 'Authorization', 'Refusing an action the caller is not allowed to take.', 6),
    ('DocsMetadata', 'guides/metadata', 'Page metadata', 'Titles, descriptions and Open Graph tags, exported from the page.', 7),
    ('DocsPpr', 'guides/ppr', 'Partial prerendering', 'Freezing the shell of a page whose data cannot be frozen.', 8),
    ('DocsStaticGeneration', 'guides/static-generation', 'Static generation', 'Rendering pages ahead of time, and exporting a site of files.', 9),
    ('DocsRouteInterception', 'guides/route-interception', 'Route interception', 'Opening a route as a modal over the page you were on.', 10),
    ('DocsTypedRoutes', 'guides/typed-routes', 'Typed routes', 'Link targets checked against the routes that exist.', 11),
    ('DocsReactCompiler', 'guides/react-compiler', 'React Compiler', 'Enabling the compiler in the build.', 12),
    ('DocsHowItWorks', 'reference/how-it-works', 'How it works', 'What happens between a request and a rendered page.', 1),
    ('DocsInstallation', 'hosts/laravel/installation', 'Installation', 'Installing the Laravel adapter and the engine.', 1),
    ('DocsConfiguration', 'hosts/laravel/configuration', 'Configuration', 'What config/rsc.php controls, and what the build controls.', 2),
    ('DocsPhpCallables', 'hosts/laravel/php-callables', 'PHP callables', 'Calling PHP from a server component with rpc().', 3),
    ('DocsDeployment', 'hosts/laravel/deployment', 'Deployment', 'Running the worker in production.', 4),
]

for source, out, title, description, order in PAGES:
    target = D / f'{out}.mdx'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(convert(S / f'{source}.tsx', title, description, order))

print(f'converted {len(PAGES)} pages')
