/* One fetch wrapper for every upstream call.

   Three jobs: a timeout, so a hanging upstream cannot hold a serverless
   invocation open until the platform kills it; a descriptive error, so the
   cache layer can log which source failed; and a User-Agent, because a
   couple of these APIs reject requests without one. */

const DEFAULT_TIMEOUT_MS = 8000;

export class UpstreamError extends Error {
  constructor(source, status, message) {
    super(`${source} failed: ${message}`);
    this.name = "UpstreamError";
    this.source = source;
    this.status = status;
  }
}

export async function getJson(url, { source = "upstream", headers = {}, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "uwuSports (https://sports.uwuapps.org)",
        ...headers,
      },
    });

    if (!response.ok) {
      throw new UpstreamError(source, response.status, `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (cause) {
    if (cause instanceof UpstreamError) throw cause;
    if (cause?.name === "AbortError") {
      throw new UpstreamError(source, 504, `no response within ${timeout}ms`);
    }
    throw new UpstreamError(source, 0, cause?.message || "network error");
  } finally {
    clearTimeout(timer);
  }
}
