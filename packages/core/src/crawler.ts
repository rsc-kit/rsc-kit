// Who is answered with the finished document.
//
// A person is sent the shell the moment it exists and everything else as it
// streams: the page paints at once, the title and the slow regions arrive
// when they are ready. The status line leaves with the shell, so a notFound()
// or a redirect() decided later than that is delivered in the body - which a
// person's browser acts on and a search engine's indexer does not. It keeps
// a 200, a soft 404.
//
// A crawler is not waiting to see anything. It is answered once the whole
// render is done: a notFound() anywhere is a real 404, a redirect anywhere a
// real 3xx, and the generated metadata is in <head> where a link preview's
// scraper reads it and nowhere else. The cost - the slowest read on the page
// before the first byte - is paid only by something that is not a person.
//
// Matched by name, from the user agents the engines and preview scrapers
// publish. A crawler missing from the list is served as a person is, which
// is correct HTML with a noindex tag where the page was missing; one that
// should be here is a line to add.

const CRAWLERS = new RegExp(
  [
    // Search engines.
    'Googlebot',
    'Google-InspectionTool',
    'Storebot-Google',
    'AdsBot-Google',
    'Mediapartners-Google',
    'bingbot',
    'BingPreview',
    'Slurp',
    'DuckDuckBot',
    'Baiduspider',
    'YandexBot',
    'YandexMobileBot',
    'Sogou',
    'Applebot',
    'PetalBot',
    'SeznamBot',
    'Yeti',
    'ia_archiver',
    // Link previews: a share card is the page's metadata, read once.
    'facebookexternalhit',
    'facebookcatalog',
    'meta-externalagent',
    'Twitterbot',
    'LinkedInBot',
    'Slackbot',
    'Discordbot',
    'TelegramBot',
    'WhatsApp',
    'redditbot',
    'Pinterestbot',
    'SkypeUriPreview',
    'vkShare',
    'Embedly',
    'bitlybot',
    'Iframely',
  ].join('|'),
  'i',
)

/** Whether this user agent is answered with the finished document. */
export function isCrawler(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && CRAWLERS.test(userAgent)
}
