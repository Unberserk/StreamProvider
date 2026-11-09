import { CinezoScraper } from './scrapers/Cinezo.js';
import { HexaScraper } from './scrapers/Hexa.js';
import { SflixScraper } from './scrapers/Sflix.js';
import { VaPlayerScraper } from './scrapers/VaPlayer.js';
import { VidZeeScraper } from './scrapers/VidZee.js';
import {
    getCachedStream,
    setCachedStream,
    updateLastAccessed,
    invalidateCache
} from './cacheService.js';
import type { ScraperResult } from './scrapers/BaseScraper.js';
import { verifyStreamUrl } from './verifyStream.js';

async function scrapeFromProviders(
    tmdbId: string,
    season?: number,
    episode?: number
): Promise<ScraperResult> {
    const providers = [{ name: 'VaPlayer', scraper: new VaPlayerScraper() }];
    if (process.env.ENABLE_BROWSER_PROVIDERS === '1') providers.push(
        { name: 'SFlix.to', scraper: new SflixScraper() },
        { name: 'Cinezo.net', scraper: new CinezoScraper() },
        { name: 'Hexa.su', scraper: new HexaScraper() },
    );

    let lastError: unknown = null;

    for (const provider of providers) {
        try {
            const data = await provider.scraper.extractStream(tmdbId, season, episode);

            if (await verifyStreamUrl(data)) {
                return data;
            }
        } catch (error) {
            lastError = error;
            console.warn(`[StreamProvider] ${provider.name}: ${error instanceof Error ? error.message : 'lookup failed'}`);
        } finally {
            await provider.scraper.close();
        }
    }

    const message = lastError instanceof Error ? lastError.message : 'All providers failed to find a stream';
    throw new Error(message);
}

async function resolvePrimary(
    tmdbId: string,
    season?: number,
    episode?: number
): Promise<ScraperResult> {
    const cached = await getCachedStream(tmdbId, season, episode);

    if (cached) {
        const isValid = await verifyStreamUrl(cached);

        if (isValid) {
            await updateLastAccessed(tmdbId, season, episode);
            return cached;
        }

        await invalidateCache(tmdbId, season, episode);
    }

    const freshData = await scrapeFromProviders(tmdbId, season, episode);
    await setCachedStream(tmdbId, season, episode, freshData);

    return freshData;
}

async function resolveVidZee(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
    const source = await new VidZeeScraper().extractStream(tmdbId, season, episode);
    if (!await verifyStreamUrl(source)) throw new Error('VidZee returned no playable HLS playlist');
    return source;
}

export async function runScraper(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
    try {
        return await resolvePrimary(tmdbId, season, episode);
    } catch (primaryError) {
        // Keep fallback streams out of the primary cache so VaPlayer gets the next attempt.
        return await resolveVidZee(tmdbId, season, episode).catch(() => { throw primaryError; });
    }
}

export async function listStreams(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult[]> {
    const [primary, backup] = await Promise.allSettled([
        resolvePrimary(tmdbId, season, episode),
        resolveVidZee(tmdbId, season, episode),
    ]);
    if (primary.status === 'fulfilled') {
        if (backup.status === 'fulfilled' && backup.value.url !== primary.value.url) return [primary.value, backup.value];
        return [primary.value];
    }
    if (backup.status === 'fulfilled') return [backup.value];
    throw primary.reason;
}
