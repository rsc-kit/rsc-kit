/**
 * The page's payload, asked for by the document rather than by the runtime.
 *
 * A page hydrates from its payload, and the runtime fetched it - after the
 * runtime's own script had downloaded and run. Then the client components the
 * payload names were loaded as it decoded. Three trips in a line, each waiting
 * on the last: Lighthouse drew it as document, then index.js, then the
 * document again, then search-dropdown.js and DefaultRouteError.js, 695 ms
 * deep on a phone.
 *
 * The bootstrap script is in the document and runs as it is parsed, so it
 * starts the request there and the runtime picks it up. The payload and the
 * runtime now download side by side, and the chunks the payload names start
 * as soon as it lands rather than after the runtime has asked for it.
 *
 * Only for a server build: a static export asks for a file by name, and the
 * runtime knows which.
 */

/** Written into the bootstrap script, ahead of the runtime's import. No backticks: it lives in a template. */
export const EARLY_PAYLOAD =
  "(function(){try{var u=location.href;window.__rsc_boot={url:u,response:fetch(u,{headers:{'X-RSC':'1'}})}}catch(e){}})();";

interface EarlyBoot {
  url: string;
  response: Promise<Response>;
}

/**
 * The payload request the document already made for this url, once.
 *
 * Taken rather than read, so only the boot uses it: a later refresh of the
 * same url must fetch again, not be handed a body that has been consumed.
 */
export function takeEarlyPayload(url: string): Promise<Response> | null {
  const w = window as unknown as { __rsc_boot?: EarlyBoot };
  const early = w.__rsc_boot;

  delete w.__rsc_boot;

  return early && early.url === url ? early.response : null;
}
