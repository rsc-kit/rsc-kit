# Installable admin plugins

A spike: can a running `@rsc-kit/press` admin panel take a plugin the way WordPress
does, installed from a screen with no rebuild, without WordPress's security
record?

It can, by refusing the one thing that makes WordPress plugins dangerous: a
plugin's code never runs in the panel's process, and never in its pages.

## The shape

A plugin is two things at one origin:

- **A manifest**: JSON, fetched once at review and again at install. It
  declares resources (columns, a JSON Schema form, bulk actions), the host
  resources it may read (`scopes: ["read:products"]`), and the resources whose
  changes it wants to hear about (`events`).
- **An endpoint**: every list, find, create, update, delete, bulk action and
  change event is a POST to it, signed with HMAC-SHA256 under a secret made
  for that installation.

The panel renders the plugin's resources with its own components, from the
manifest's declarations, exactly as it renders a resource defined in code. The
plugin supplies data and verdicts, never markup or scripts.

```
x-rsc-admin-installation  which installation is calling
x-rsc-admin-timestamp     seconds; older than 5 minutes is refused (replay)
x-rsc-admin-signature     sha256=hex(hmac(secret, "<timestamp>.<body>"))
```

`@rsc-kit/press/signing` exports `verifyPluginRequest`, Web Crypto only, so a
plugin written on Bun, Node or a Worker checks a call in one line.

Build-time `definePlugin` stays as it was: the trusted tier, for code the app
ships.

## Installing

1. Someone the panel's `installs.manage()` admits pastes a manifest url.
2. The panel fetches it (rules below), validates it strictly, and shows what it
   adds, what it can see in plain words, and where it runs.
3. Install posts the url and the digest of what was reviewed. The panel fetches
   again; a manifest that changed in between is refused, not silently
   installed.
4. The installation is stored for the current tenant with a new secret, shown
   once on the Plugins page until "I've copied it". It never travels in a
   flash cookie or a url.
5. The person pastes the installation id and secret into the plugin's own
   settings. Until then the plugin refuses every call.

Uninstalling deletes the installation and its secret, so every call the plugin
could answer stops at once, and its resources leave the sidebar in the same
response.

## Threat model

| Threat | Answer |
| --- | --- |
| A plugin runs code in the panel | It cannot. There is no code to load: a manifest is data, rendered by the panel's components. |
| A plugin reads what it was not granted | It is sent only its own resources' calls, and events and relation lookups for resources its scopes name. A relation to a host resource without `read:` is refused at validation. |
| A manifest asks for a permission the panel does not understand | Unknown fields are refused. A field ignored is a permission the person reviewing did not see. |
| A manifest changes between review and install | The digest is compared at install. It is also re-validated on every request; an installation that stopped validating is skipped and logged. |
| SSRF: a manifest url or endpoint aimed at the panel's network | `allow(url)` defaults to `publicHttps`: https, a name, not localhost, not an IP literal, not `.local` / `.internal`. No redirects are followed. The endpoint must share the manifest's origin. |
| A slow or huge plugin | Timeouts on every call (10s, 3s for events), size caps (256 KB manifest, 5 MB answers). A dashboard count from a plugin that is down shows "—", not an error page. |
| ReDoS through a form's `pattern` | Patterns are never run on the server; they reach the browser as a hint, and the plugin enforces its own rules with a 422. |
| A forged call to the plugin | HMAC over timestamp and body, constant-time compare, an empty secret refused, a stale timestamp refused. |
| One tenant's plugin seen by another | Installations are per tenant; `/admin/reviews` is a 404 for a team that did not install it. |
| Name squatting | A plugin may not take a host resource's name, another plugin's, or the panel's own `plugins` / `new`. |

What the panel trusts a plugin with is its own rows: it can answer a list with
anything, which is shown as text through the panel's components. A rule only
the plugin knows comes back as a 422 `{ errors }` and lands under the form's
fields, the same contract a Laravel backend uses.

## Left out, on purpose

- **Custom UI.** No iframe, no remote components. A plugin that needs its own
  screen links to its own site. A sandboxed iframe with a postMessage contract
  is the next step if this is wanted; it is a separate threat model.
- **DNS rebinding.** `publicHttps` checks the name, not what it resolves to at
  the moment of the fetch. A deployment that must defend against it puts an
  egress proxy in front, or passes an `allow` that resolves and pins.
- **An inbound API.** A plugin cannot call the panel; it only answers. Writing
  into host resources would need scoped tokens and is not here.
- **Who is acting.** Calls carry the tenant, not the visitor. A plugin that
  audits per person needs a user claim in the signed body.
- **Durable storage.** `memoryInstallations()` is for the example and tests. A
  real app keeps installations in its database, the secret encrypted.

## Found along the way

An action that redirected was followed as a navigation that kept the layouts
it held unrendered, so a team switch left the old team's name and nav in the
sidebar until a reload - and a `revalidate('all')` before the redirect was
dropped. Fixed in core (#377): a redirect still keeps the layouts by default,
and a revalidation before it now travels with it, so `switchTenant` asks for
the destination whole by saying so. Install and uninstall revalidate in place
- the page they answer from is the page they belong on.
