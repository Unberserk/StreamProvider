import { BaseScraper, ScraperResult } from './BaseScraper.js';

export class CinezoScraper extends BaseScraper {
    async extractStream(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
        await this.initialize();
        if (!this.page) throw new Error("Browser failed");

        let url;

        if (season && episode) {
            url = `https://www.cinezo.net/watch/tv/${tmdbId}?season=${season}&episode=${episode}`;
        } else {
            url = `https://www.cinezo.net/watch/movie/${tmdbId}`;
        }
        
        await this.page.goto(url);
        
        return await this.waitForM3u8();
    }
}