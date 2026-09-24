/**
 * Component names that survive a second bundler.
 *
 * A partially prerendered page is finished by replaying the tree the build
 * recorded, and React matches each slot of that tree by component name -
 * `type.displayName || type.name`. The name is whatever the function is
 * called in the code that rendered it, and that is not a stable thing: a
 * bundler that merges module scopes renames whatever collides. Two
 * different components of one name is ordinary - an app's TooltipProvider
 * wrapping a library's is what shadcn writes - and while they are two
 * modules both keep the name. `bun build --compile` merges them and one
 * becomes TooltipProvider2, `.name` and all; `--keep-names` does not stop
 * a collision rename. The shell then says <TooltipProvider>, the binary
 * renders <TooltipProvider2>, React refuses the replay and every hole falls
 * to the browser.
 *
 * So each chunk of the server's render of client components ends with a
 * statement giving every top-level function the name it has in THIS
 * output, as a string, through `displayName` - the half React reads first.
 * The prerender and whatever serves the page run the same statement with
 * the same literal, so they agree whatever a later bundler calls the
 * binding. Only top-level bindings: those are what a scope merge renames.
 *
 * An existing displayName is left alone - it is already the stable half.
 * Contexts keep theirs too: React names a context "Context" whatever the
 * binding is called, so there is nothing for a rename to change.
 */

interface Node {
  type: string
  id?: { type: string; name: string } | null
  init?: Node | null
  declaration?: Node | null
  declarations?: Node[]
}

/** Whether a declarator's initialiser can be a component. */
function mayBeComponent(init: Node | null | undefined): boolean {
  if (!init) return false

  // A call can return one: memo(), forwardRef(), a styled() factory. The
  // statement checks at runtime and skips anything that is not.
  return (
    init.type === 'FunctionExpression' ||
    init.type === 'ArrowFunctionExpression' ||
    init.type === 'ClassExpression' ||
    init.type === 'CallExpression'
  )
}

/** The top-level bindings in a program that may hold a component, by name. */
export function componentBindings(program: { body: Node[] }): string[] {
  const names = new Set<string>()

  const take = (node: Node | null | undefined): void => {
    if (!node) return

    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id?.name) {
      names.add(node.id.name)

      return
    }

    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations ?? []) {
        if (declarator.id?.type === 'Identifier' && mayBeComponent(declarator.init)) names.add(declarator.id.name)
      }
    }
  }

  for (const node of program.body) {
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') take(node.declaration)
    else take(node)
  }

  return [...names]
}

/**
 * The statement a chunk ends with. Runs once, at load, after everything the
 * chunk declares has been assigned - a library that sets its own
 * displayName has done so by then, and keeps it.
 */
export function displayNameStamp(names: string[]): string {
  if (names.length === 0) return ''

  const pairs = names.map((name) => `[${name},${JSON.stringify(name)}]`).join(',')

  return (
    '\n;(function(p){for(var i=0;i<p.length;i++){var f=p[i][0];try{' +
    'if(typeof f==="function"||(f!==null&&typeof f==="object"&&(f.$$typeof===Symbol.for("react.memo")||f.$$typeof===Symbol.for("react.forward_ref")))){' +
    'if(!Object.prototype.hasOwnProperty.call(f,"displayName"))Object.defineProperty(f,"displayName",{value:p[i][1],configurable:true,writable:true})' +
    '}}catch(e){}}})([' +
    pairs +
    ']);\n'
  )
}

/** A chunk with its components' names made stable. Unchanged if it cannot be read. */
export function stampDisplayNames(code: string, parse: (code: string) => { body: Node[] }): string {
  let names: string[]

  try {
    names = componentBindings(parse(code))
  } catch {
    return code
  }

  return code + displayNameStamp(names)
}
