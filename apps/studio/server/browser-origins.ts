const localOrigins = ['http://127.0.0.1:3100', 'http://localhost:3100', 'http://127.0.0.1:3021'];

/** Exact browser origins for authenticated private previews; never trust forwarded host headers. */
export function browserOrigins(configured = process.env.STUDIO_ALLOWED_ORIGINS ?? ''): Set<string> {
  const origins = new Set(localOrigins);
  for (const entry of configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)) {
    const url = new URL(entry);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error(
        'STUDIO_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins without credentials, paths, queries or fragments.',
      );
    origins.add(url.origin);
  }
  return origins;
}
