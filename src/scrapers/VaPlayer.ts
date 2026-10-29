import { BaseScraper, type ScraperResult } from './BaseScraper.js';
import { resolveTmdbImdbId } from '../tmdbClient.js';
import { verifyStreamUrl } from '../verifyStream.js';

const REFERER = 'https://nextgencloudfabric.com/';

export class VaPlayerScraper extends BaseScraper {
    async extractStream(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
        const imdb = await resolveTmdbImdbId(tmdbId, season !== undefined);
        const endpoint = new URL('https://streamdata.vaplayer.ru/api.php');
        endpoint.searchParams.set('imdb', imdb);
        endpoint.searchParams.set('type', season === undefined ? 'movie' : 'tv');
        if (season !== undefined && episode !== undefined) {
            endpoint.searchParams.set('season', String(season));
            endpoint.searchParams.set('episode', String(episode));
        }
        const response = await fetch(endpoint, {
            headers: { Accept: 'application/json', Referer: REFERER },
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`VaPlayer HTTP ${response.status}`);
        const data = await response.json() as { data?: { imdb_id?: string; stream_urls?: unknown } };
        if (data.data?.imdb_id && data.data.imdb_id !== imdb) throw new Error('VaPlayer returned a different title');
        if (Array.isArray(data.data?.stream_urls)) {
            for (const url of data.data.stream_urls.slice(0, 3)) {
                if (typeof url !== 'string') continue;
                const source = { url, referer: REFERER, provider: 'VaPlayer' };
                if (await verifyStreamUrl(source)) return source;
            }
        }
        throw new Error('No playable HLS stream for this title and episode');
    }
}
