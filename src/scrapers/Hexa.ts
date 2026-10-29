import { BaseScraper, ScraperResult } from './BaseScraper.js';

export class HexaScraper extends BaseScraper {
    async extractStream(tmdbId: string, season?: number, episode?: number): Promise<ScraperResult> {
        await this.initialize();
        if (!this.page) throw new Error("Browser failed");

        let url;

        if (season && episode) {
            url = `https://hexa.su/watch/tv/${tmdbId}/${season}/${episode}`;
        } else {
            url = `https://hexa.su/watch/movie/${tmdbId}`;
        }
        
        await this.page.goto(url);
        
        return await this.waitForM3u8();
    }
}