import { CinezoScraper } from './scrapers/Cinezo.ts';
import { HexaScraper } from './scrapers/Hexa.ts';
import { SflixScraper } from './scrapers/Sflix.ts';
import { VaPlayerScraper } from './scrapers/VaPlayer.ts';
import {
    getCachedStream,
    setCachedStream,
    updateLastAccessed,
    invalidateCache
} from './cacheService.ts';
import type { ScraperResult } from './scrapers/BaseScraper.ts';
import { verifyStreamUrl } from './verifyStream.ts';

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

export async function runScraper(
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
