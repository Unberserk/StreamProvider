import { BaseScraper, type ScraperResult } from './BaseScraper.js';

const REFERER = 'https://player.vidzee.wtf/';

export class VidZeeScraper extends BaseScraper {
    async extractStream(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
        const path = season === undefined ? `movie/${tmdbId}` : `tv/${tmdbId}/${season}/${episode}`;
        const endpoint = new URL(`https://core.vidzee.wtf/streams/${path}`);
        endpoint.search = new URLSearchParams({ s: 'dcloud', e: '0' }).toString();
        const response = await fetch(endpoint, {
            headers: { Accept: 'application/json', Referer: REFERER, Origin: new URL(REFERER).origin },
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`VidZee HTTP ${response.status}`);
        const { url } = await response.json() as { url?: unknown };
        if (typeof url !== 'string' || !URL.canParse(url)) throw new Error('VidZee returned no stream');
        const stream = new URL(url);
        if (stream.protocol !== 'https:' || stream.port || stream.username || stream.password
            || !stream.hostname.endsWith('.slowcloud.live') || !/\.m3u8$/i.test(stream.pathname)) {
            throw new Error('VidZee returned an unsupported stream');
        }
        return { url, referer: REFERER, provider: 'VidZee dcloud' };
    }
}
