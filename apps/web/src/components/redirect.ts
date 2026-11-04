/**
 * Gir en trygg intern sti å sende brukeren til etter innlogging. Bare stier som begynner med
 * nøyaktig én `/` godtas. `//vert`, `/\vert` og alt annet gir `/`, slik at React Router aldri
 * blir bedt om å navigere ut av appen.
 */
export function safeRedirectTarget(from: unknown): string {
  if (typeof from !== 'string' || from.length === 0) return '/';
  if (!from.startsWith('/')) return '/';
  const second = from.charAt(1);
  if (second === '/' || second === '\\') return '/';
  // Kontrolltegn (tab, linjeskift) kan få nettlesere til å tolke stien annerledes.
  for (const ch of from) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return '/';
  }
  if (from === '/logg-inn' || from.startsWith('/logg-inn?') || from.startsWith('/logg-inn/')) return '/';
  return from;
}
