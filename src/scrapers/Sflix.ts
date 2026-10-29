import { BaseScraper, ScraperResult } from './BaseScraper.js';
import { resolveTmdbLookupMetadata } from '../tmdbClient.js';
import {
    selectBestEpisodeOption,
    selectBestSearchCandidate,
    selectBestSeasonOption,
    type SflixSearchCandidate
} from './sflixMatcher.js';

const SFLIX_BASE_URL = (process.env.SFLIX_BASE_URL ?? 'https://sflix2.to').replace(/\/+$/, '');
const SFLIX_NAV_TIMEOUT_MS = Number(process.env.SFLIX_NAV_TIMEOUT_MS ?? 12000);
const SFLIX_STREAM_TIMEOUT_MS = Number(process.env.SFLIX_STREAM_TIMEOUT_MS ?? 12000);
const SFLIX_DOM_READY_TIMEOUT_MS = Number(process.env.SFLIX_DOM_READY_TIMEOUT_MS ?? 18000);
const SFLIX_SELECTION_RETRIES = Number(process.env.SFLIX_SELECTION_RETRIES ?? 2);
const SFLIX_RETRY_DELAY_MS = Number(process.env.SFLIX_RETRY_DELAY_MS ?? 700);
const SFLIX_BLOCKED_RESOURCE_TYPES = new Set(['font', 'stylesheet', 'image', 'media']);

export class SflixScraper extends BaseScraper {
    private hasClosedShareModal = false;
    private networkOptimizationsEnabled = false;

    async extractStream(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
        const metadataPromise = resolveTmdbLookupMetadata(tmdbId, season, episode);
        await this.initialize();
        const page = this.requirePage();
        this.hasClosedShareModal = false;
        this.networkOptimizationsEnabled = false;
        await this.enableNetworkOptimizations();

        const metadata = await metadataPromise;
        if (metadata.mediaType === 'tv' && (!season || !episode)) {
            throw new Error('TV_REQUIRES_SEASON_EPISODE');
        }

        const searchTitles = [...new Set([metadata.title, metadata.originalTitle])].filter(
            (value): value is string => Boolean(value && value.trim())
        );
        const chosenResult = await this.findBestSearchResult(searchTitles, metadata.releaseYear);
        const detailUrl = this.toAbsoluteUrl(chosenResult.href);

        try {
            if (metadata.mediaType === 'movie') {
                const movieWatchUrl = this.toMovieWatchUrl(detailUrl);
                await page.goto(movieWatchUrl, { waitUntil: 'domcontentloaded', timeout: SFLIX_NAV_TIMEOUT_MS });
                await this.closeShareModalIfPresent();
                return await this.waitForStreamRequest(SFLIX_STREAM_TIMEOUT_MS);
            }

            await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: SFLIX_NAV_TIMEOUT_MS });
            await this.ensureOnSflixHost(detailUrl);

            if (!('seasonNumber' in metadata) || !('episodeNumber' in metadata)) {
                throw new Error('TV_EPISODE_METADATA_REQUIRED');
            }

            const selectedSeasonTargetId = await this.selectSeason(metadata.seasonNumber, metadata.seasonName);
            await this.selectEpisode(metadata.episodeNumber, metadata.episodeName, selectedSeasonTargetId);
            await this.ensureOnSflixHost(detailUrl);
            await this.closeShareModalIfPresent();
            return await this.waitForStreamRequest(SFLIX_STREAM_TIMEOUT_MS);
        } finally {
            await page.close();
        }
    }

    private async findBestSearchResult(titles: string[], releaseYear: number): Promise<SflixSearchCandidate> {
        const page = this.requirePage();

        for (const title of titles) {
            const searchSlug = this.toSearchSlug(title);
            if (!searchSlug) continue;
            const searchUrl = `${SFLIX_BASE_URL}/search/${searchSlug}`;
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: SFLIX_NAV_TIMEOUT_MS });

            const candidates = await page.evaluate(() => {
                const container =
                    document.querySelector('#main-wrapper > div > section > div.block_area-content.block_area-list.film_list.film_list-grid > div') ||
                    document.querySelector('.film_list-wrap');

                if (!container) return [];

                return Array.from(container.querySelectorAll(':scope > div')).map((card, index) => {
                    const titleText = card.querySelector('.film-detail > h2 > a')?.textContent?.trim() ?? '';
                    const yearText =
                        card.querySelector('.film-detail > .fd-infor > span:nth-child(1)')?.textContent?.trim() ??
                        card.querySelector('.film-detail > .fd-infor > span')?.textContent?.trim() ??
                        '';

                    const href =
                        (card.querySelector('.film-detail > .fd-btn > a') as HTMLAnchorElement | null)?.getAttribute('href') ??
                        (card.querySelector('.film-detail > h2 > a') as HTMLAnchorElement | null)?.getAttribute('href') ??
                        '';

                    const yearMatch = yearText.match(/\d{4}/);
                    const yearValue = yearMatch ? Number(yearMatch[0]) : null;

                    return {
                        index,
                        title: titleText,
                        year: Number.isFinite(yearValue) ? yearValue : null,
                        href
                    };
                }).filter((entry) => entry.title && entry.href);
            });

            const match = selectBestSearchCandidate(candidates, title, releaseYear);
            if (match) return match;
        }

        throw new Error('SFLIX_NO_MATCH');
    }

    private async selectSeason(expectedSeasonNumber: number, expectedSeasonName?: string): Promise<string | undefined> {
        const page = this.requirePage();
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= SFLIX_SELECTION_RETRIES; attempt += 1) {
            try {
                await this.waitForSeasonData();

                const seasons = await page.evaluate(() => {
                    const menu =
                        document.querySelector('#content-episodes .dropdown-menu.dropdown-menu-model') ||
                        document.querySelector('#content-episodes .dropdown-menu');

                    if (!menu) return [];

                    return Array.from(menu.querySelectorAll('a')).map((anchor, index) => ({
                        index,
                        text: anchor.textContent?.trim() ?? '',
                        targetId: anchor.getAttribute('href')?.replace(/^#/, '') ?? undefined,
                        anchorId: anchor.getAttribute('id') ?? undefined
                    }));
                });

                const seasonMatch = selectBestSeasonOption(seasons, expectedSeasonNumber, expectedSeasonName);
                if (!seasonMatch) {
                    throw new Error('SEASON_NOT_FOUND');
                }

                const clicked = await page.evaluate((index) => {
                    const menu =
                        document.querySelector('#content-episodes .dropdown-menu.dropdown-menu-model') ||
                        document.querySelector('#content-episodes .dropdown-menu');
                    if (!menu) return false;

                    const links = Array.from(menu.querySelectorAll('a'));
                    const target = links[index] as HTMLElement | undefined;
                    if (!target) return false;
                    target.click();
                    return true;
                }, seasonMatch.index);

                if (!clicked) {
                    throw new Error('SEASON_CLICK_FAILED');
                }

                await this.waitForEpisodeData(seasonMatch.targetId);
                return seasonMatch.targetId;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error('SEASON_SELECTION_FAILED');
                if (attempt >= SFLIX_SELECTION_RETRIES) break;
                await page.waitForTimeout(SFLIX_RETRY_DELAY_MS);
            }
        }

        throw lastError ?? new Error('SEASON_NOT_FOUND');
    }

    private async selectEpisode(
        expectedEpisodeNumber: number,
        expectedEpisodeName?: string,
        preferredSeasonId?: string
    ): Promise<void> {
        const page = this.requirePage();
        await this.waitForEpisodeData(preferredSeasonId);

        const episodes = await page.evaluate((selectedSeasonId) => {
            const byPreferred = selectedSeasonId ? document.querySelector(`#${selectedSeasonId}`) : null;
            const activeSeason =
                byPreferred ||
                document.querySelector('#content-episodes div[id^="ss-episodes-"].active') ||
                document.querySelector('#content-episodes div[id^="ss-episodes-"]');
            if (!activeSeason) return [];

            return Array.from(activeSeason.querySelectorAll('div[id^="episode-"]')).map((entry, index) => {
                const id = entry.getAttribute('id') ?? undefined;
                const episodeTitle =
                    entry.querySelector('div > h3 > a')?.textContent?.trim() ||
                    entry.querySelector('div > div')?.textContent?.trim() ||
                    '';
                const numberMatch = episodeTitle.match(/\b(\d+)\b/);
                return {
                    index,
                    id,
                    number: numberMatch ? Number(numberMatch[1]) : null,
                    title: episodeTitle
                };
            }).filter((entry) => entry.id && entry.title);
        }, preferredSeasonId);

        const episodeMatch = selectBestEpisodeOption(episodes, expectedEpisodeNumber, expectedEpisodeName);
        if (!episodeMatch?.id) {
            throw new Error('EPISODE_NOT_FOUND');
        }

        await page.locator(`#${episodeMatch.id} > a`).click({ timeout: SFLIX_NAV_TIMEOUT_MS });
    }

    private async waitForSeasonData(): Promise<void> {
        const page = this.requirePage();

        await page.waitForFunction(() => {
            const menu =
                document.querySelector('#content-episodes .dropdown-menu.dropdown-menu-model') ||
                document.querySelector('#content-episodes .dropdown-menu');
            if (menu && menu.querySelectorAll('a').length > 0) {
                return true;
            }

            return document.querySelectorAll('#content-episodes div[id^="ss-episodes-"]').length > 0;
        }, undefined, { timeout: SFLIX_DOM_READY_TIMEOUT_MS });
    }

    private async waitForEpisodeData(preferredSeasonId?: string): Promise<void> {
        const page = this.requirePage();

        await page.waitForFunction((selectedSeasonId) => {
            const preferred = selectedSeasonId ? document.querySelector(`#${selectedSeasonId}`) : null;
            const container =
                preferred ||
                document.querySelector('#content-episodes div[id^="ss-episodes-"].active') ||
                document.querySelector('#content-episodes div[id^="ss-episodes-"]');
            if (!container) return false;

            return container.querySelectorAll('div[id^="episode-"]').length > 0;
        }, preferredSeasonId, { timeout: SFLIX_DOM_READY_TIMEOUT_MS });
    }

    private async waitForStreamRequest(timeout = 10000): Promise<ScraperResult> {
        const page = this.requirePage();
        await this.closeShareModalIfPresent();

        return this.waitForM3u8(timeout);
    }

    private toAbsoluteUrl(input: string): string {
        if (input.startsWith('http://') || input.startsWith('https://')) {
            return input;
        }
        return `${SFLIX_BASE_URL}${input.startsWith('/') ? '' : '/'}${input}`;
    }

    private toMovieWatchUrl(detailUrl: string): string {
        if (detailUrl.includes('/watch-movie/')) return detailUrl;
        return detailUrl.replace('/movie/', '/watch-movie/');
    }

    private toSearchSlug(title: string): string {
        return title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    private async ensureOnSflixHost(fallbackUrl: string): Promise<void> {
        const page = this.requirePage();
        if (this.isSflixUrl(page.url())) return;
        await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: SFLIX_NAV_TIMEOUT_MS });
    }

    private isSflixUrl(rawUrl: string): boolean {
        try {
            const parsed = new URL(rawUrl);
            return parsed.hostname === 'sflix2.to' || parsed.hostname.endsWith('.sflix2.to');
        } catch {
            return false;
        }
    }

    private async closeShareModalIfPresent(): Promise<boolean> {
        if (this.hasClosedShareModal) return false;
        const page = this.requirePage();

        const closed = await page.evaluate(() => {
            const closeButton = document.querySelector('#modalshare > div > div > div > div > div.text-close') as HTMLElement | null;
            if (!closeButton) return false;
            closeButton.click();
            return true;
        });

        if (closed) {
            this.hasClosedShareModal = true;
        }

        return closed;
    }

    private async enableNetworkOptimizations(): Promise<void> {
        if (this.networkOptimizationsEnabled) return;
        const page = this.requirePage();

        await page.route('**/*', async (route) => {
            if (SFLIX_BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
                await route.abort();
                return;
            }
            await route.continue();
        });

        this.networkOptimizationsEnabled = true;
    }
}
