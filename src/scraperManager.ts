import { CinezoScraper } from './scrapers/Cinezo.js';
import { HexaScraper } from './scrapers/Hexa.js';
import { SflixScraper } from './scrapers/Sflix.js';
import { VaPlayerScraper } from './scrapers/VaPlayer.js';
import { VidZeeScraper } from './scrapers/VidZee.js';
import { VixSrcScraper } from './scrapers/VixSrc.js';
import {
    getCachedStream,
    setCachedStream,
    updateLastAccessed,
    invalidateCache
} from './cacheService.js';
import type { BaseScraper, ScraperResult } from './scrapers/BaseScraper.js';
import { verifyStreamUrl } from './verifyStream.js';

type StreamOptions = { includePreviews?: boolean; refresh?: boolean };

async function scrapeFromProviders(
    tmdbId: string,
    season: number | undefined,
    episode: number | undefined,
    includePreviews: boolean
): Promise<ScraperResult> {
    const vaPlayer = new VaPlayerScraper(includePreviews);
    const providers: { name: string; scraper: BaseScraper }[] = [{ name: 'VaPlayer', scraper: vaPlayer }];
    if (process.env.ENABLE_BROWSER_PROVIDERS === '1') providers.push(
        { name: 'SFlix.to', scraper: new SflixScraper() },
        { name: 'Cinezo.net', scraper: new CinezoScraper() },
        { name: 'Hexa.su', scraper: new HexaScraper() },
    );

    let lastError: unknown = null;

    for (const provider of providers) {
        try {
            const data = await provider.scraper.extractStream(tmdbId, season, episode);

            if (provider.scraper === vaPlayer || await verifyStreamUrl(data)) {
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
    season: number | undefined,
    episode: number | undefined,
    { includePreviews = true, refresh = false }: StreamOptions
): Promise<ScraperResult> {
    const cached = refresh ? null : await getCachedStream(tmdbId, season, episode);
    const needsPreviews = includePreviews && cached?.provider === 'VaPlayer' && cached.previewFrames === undefined;

    if (cached && !needsPreviews) {
        const isValid = await verifyStreamUrl(cached);

        if (isValid) {
            await updateLastAccessed(tmdbId, season, episode);
            if (includePreviews) return cached;
            return { url: cached.url, referer: cached.referer, provider: cached.provider };
        }

        await invalidateCache(tmdbId, season, episode);
    }

    const freshData = await scrapeFromProviders(tmdbId, season, episode, includePreviews);
    await setCachedStream(tmdbId, season, episode, freshData);

    return freshData;
}

async function verifiedBackup(scraper: BaseScraper, tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
    const source = await scraper.extractStream(tmdbId, season, episode);
    if (!await verifyStreamUrl(source)) throw new Error('Backup returned no playable HLS playlist');
    return source;
}

export async function runScraper(tmdbId: string, season?: number, episode?: number, options: StreamOptions = {}): Promise<ScraperResult> {
    try {
        return await resolvePrimary(tmdbId, season, episode, options);
    } catch (primaryError) {
        // Resolve the backups independently. The first existing backup retains priority.
        const vix = verifiedBackup(new VixSrcScraper(), tmdbId, season, episode).catch(() => null);
        const vidzee = await verifiedBackup(new VidZeeScraper(), tmdbId, season, episode).catch(() => null);
        if (vidzee) return vidzee;
        const fallback = await vix;
        if (fallback) return fallback;
        throw primaryError;
    }
}

export async function listStreams(tmdbId: string, season?: number, episode?: number, options: StreamOptions = {}): Promise<ScraperResult[]> {
    const results = await Promise.allSettled([
        resolvePrimary(tmdbId, season, episode, options),
        verifiedBackup(new VidZeeScraper(), tmdbId, season, episode),
        verifiedBackup(new VixSrcScraper(), tmdbId, season, episode),
    ]);
    const streams = new Map<string, ScraperResult>();
    for (const result of results) {
        if (result.status === 'fulfilled' && !streams.has(result.value.url)) streams.set(result.value.url, result.value);
    }
    const primary = results[0];
    if (streams.size === 0 && primary.status === 'rejected') throw primary.reason;
    return [...streams.values()];
}
