import { BaseScraper, type ScraperResult } from './BaseScraper.js';

const BASE = 'https://vixsrc.to/';
const ORIGIN = new URL(BASE).origin;

export class VixSrcScraper extends BaseScraper {
    async extractStream(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
        const path = season === undefined ? 'movie/' + tmdbId : ['tv', tmdbId, season, episode].join('/');
        const signal = AbortSignal.timeout(6000);
        const response = await fetch(new URL('api/' + path, BASE), {
            headers: { Accept: 'application/json' },
            redirect: 'error',
            signal,
        });
        if (!response.ok) throw new Error('VixSrc lookup HTTP ' + response.status);
        const { src } = await response.json() as { src?: unknown };
        if (typeof src !== 'string') throw new Error('VixSrc returned no player');
        const embed = new URL(src, BASE);
        const mediaId = embed.pathname.match(/^\/embed\/(\d+)$/)?.[1];
        if (embed.origin !== ORIGIN || embed.username || embed.password || !mediaId) {
            throw new Error('VixSrc returned an unsupported player');
        }

        const page = await fetch(embed, { headers: { Referer: BASE }, redirect: 'error', signal });
        if (!page.ok) throw new Error('VixSrc player HTTP ' + page.status);
        const html = await page.text();
        // Read the public player's playback parameters without executing the page.
        const raw = html.match(/\burl\s*:\s*(['"])(https:\/\/[^'"]+\/playlist\/\d+(?:\?[^'"]*)?)\1/i)?.[2];
        const token = html.match(/["']?token["']?\s*:\s*(['"])([A-Za-z0-9_.~+\/=-]{8,256})\1/)?.[2];
        const expires = html.match(/["']?expires["']?\s*:\s*['"]?(\d{10})\b/)?.[1];
        if (!raw || !token || !expires || Number(expires) * 1000 < Date.now() + 30000) {
            throw new Error('VixSrc returned no current playback link');
        }
        const playlist = new URL(raw);
        if (playlist.origin !== ORIGIN || playlist.username || playlist.password || playlist.pathname !== '/playlist/' + mediaId) {
            throw new Error('VixSrc returned an unsupported playlist');
        }
        playlist.searchParams.set('token', token);
        playlist.searchParams.set('expires', expires);
        playlist.searchParams.set('h', '1');
        return { url: playlist.href, referer: BASE, provider: 'VixSrc' };
    }
}
