export interface StaticConfig {
  dir?: string           // default: 'public'
  maxAge?: number        // Cache-Control max-age in seconds
  immutable?: boolean    // Cache-Control immutable
  // How to treat path segments beginning with `.` (e.g. `.env`, `.git`).
  // 'ignore' (default) and 'deny' both refuse to serve them; 'allow' disables
  // the dotfile guard entirely and will serve `.env`/`.git`, so only use it
  // when the root is known to contain no secrets.
  dotFiles?: 'ignore' | 'deny' | 'allow'  // default: 'ignore'
  etag?: boolean         // default: true
  index?: string         // default: 'index.html'
  // How to treat symlinks whose real target escapes `dir`. 'follow' (default,
  // backward compatible) serves whatever the link points at; 'deny' resolves
  // the real path and refuses to serve anything outside the root.
  symlinks?: 'follow' | 'deny'
}
