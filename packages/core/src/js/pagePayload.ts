import { reportClientFailure, throwForFailedPayload } from "./errors";
import { reportReachable } from "./onlineStore";

/**
 * Fetch the payload the page hydrates from, and account for it failing.
 *
 * This is the one request with nothing watching it. A PPR route's shell is
 * real HTML with a 200, so a page whose payload never arrives looks like it
 * loaded and then sits on its Suspense fallbacks indefinitely — no error, no
 * fallback, nothing an app can react to.
 *
 * Kept apart from createViteRscApp because that module imports the Flight
 * browser runtime, which reaches a Vite virtual module that exists only inside
 * a build. Nothing there can be imported by a test, which is how this handling
 * came to have none.
 */
export async function fetchPagePayload(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetchImpl(url, { headers: { "X-RSC": "1" } });
  } catch (err) {
    // Nothing answered, so the app is offline as far as the router is
    // concerned — which is what useOffline reads.
    reportReachable(false);
    reportClientFailure("could not fetch the page payload", err);

    throw err;
  }

  // Something answered, whatever it said.
  reportReachable(true);

  try {
    throwForFailedPayload(response);
  } catch (err) {
    reportClientFailure("the server could not render this page", err);

    throw err;
  }

  return response;
}
