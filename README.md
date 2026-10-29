# StreamProvider for Spike Roku

Looks up a direct HTTPS HLS playlist for a TMDB movie or a specific television/anime episode. The default provider is VaPlayer's JSON API. Roku downloads video directly from the returned media host; Vercel handles only the lookup. No computer, database or paid hosting is required for this configuration, within Vercel Hobby usage limits.

## API

Hosted instance: https://stream-provider.vercel.app

```text
GET /health
GET /?tmdbId=550
GET /?tmdbId=1399&season=1&episode=1
GET /?tmdbId=1429&season=1&episode=1
```

Success returns `{ "url": "https://…/master.m3u8", "referer": "https://…/", "provider": "VaPlayer", "format": "hls" }`. Preserve the returned Referer for playlist and segment requests. URLs can expire; resolve again when resuming later. A missing title/episode returns HTTP 404 with `code: NO_HLS_STREAM`; availability depends on the upstream provider. No substitute title or sample video is returned.

Anime uses its TMDB series ID and TMDB season/episode numbering. Spike's anime matcher translates its anime catalog IDs before calling this API.

## Vercel

Import this repository as an Express project. Set either `TMDB_READ_TOKEN` (the TMDB API Read Access Token) or `TMDB_API_KEY` in the project's encrypted environment variables, then deploy. Node 22 is pinned in package.json. No DATABASE_URL is needed: the Vercel configuration uses a bounded, five-minute memory cache and revalidates cached playlists. The cache is temporary and separate for each running instance.

`/health` works without starting a browser or connecting to a database. Lookups return only a URL; there is deliberately no media relay that would send an entire movie through Vercel.

## Local development

Copy `.env.example` to `.env`, add TMDB credentials, then:

```sh
npm ci
node --env-file=.env --import tsx src/index.ts
npm run check
npm test
```

Optional local PostgreSQL caching still supports DATABASE_URL. The original Sflix/Cinezo/Hexa browser providers are opt-in with `ENABLE_BROWSER_PROVIDERS=1`; they are disabled by default because live checks on October 29, 2026 found Sflix down (521), Cinezo's player forbidden (403), and Hexa requiring interactive verification. Enabling them is not a guarantee of availability. Local browser use needs `BROWSER_CHANNEL=chrome` or an installed Patchright browser; optional Vercel browser use includes a serverless Chromium binary.

The original upstream public host `streamprovider.byteful.me` is no longer the endpoint for this fork. Original provider logic remains credited to byteful/StreamProvider; see LICENSE.
