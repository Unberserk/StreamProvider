import type { Page } from 'patchright';
import { getBrowserContext } from '../browser.ts';

export abstract class BaseScraper {
    protected page: Page | null = null;
    private detected: ScraperResult[] = [];

    async initialize(): Promise<void> {
        this.page = await (await getBrowserContext()).newPage();
        this.detected = [];
        this.page.on('request', request => {
            if (/\.m3u8(?:[?#]|$)/i.test(request.url())) {
                this.detected.push({ url: request.url(), referer: request.headers().referer });
            }
        });
        await this.page.route('**/*', async route => {
            if (['font', 'stylesheet', 'image', 'media'].includes(route.request().resourceType())) await route.abort();
            else await route.continue();
        });
    }

    protected requirePage(): Page {
        if (!this.page) throw new Error('Page not initialized');
        return this.page;
    }

    async close(): Promise<void> {
        if (this.page) await this.page.close().catch(() => {});
        this.page = null;
    }

    abstract extractStream(imdbId: string, season?: number, episode?: number): Promise<ScraperResult>;

    async waitForM3u8(timeout = 10000): Promise<ScraperResult> {
        const page = this.requirePage();

        if (this.detected.length) return this.detected[this.detected.length - 1];
        try {
            const request = await page.waitForRequest(
                (req) => /\.m3u8(?:[?#]|$)/i.test(req.url()),
                { timeout }
            );

            return { url: request.url(), referer: request.headers().referer };
        } catch {
            throw new Error('Timeout: No streams detected.');
        }
    }
}

export type ScraperResult = {
    url: string;
    referer?: string;
    provider?: string;
}
