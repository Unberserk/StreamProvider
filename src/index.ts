import express, { type Request, type Response } from 'express';
import PQueue from 'p-queue';
import { runScraper } from './scraperManager.js';
import { initDatabase, pool } from './database.js';
import { runCacheCleanup } from './cacheService.js';
import { resolveNextTvEpisodes } from './tmdbClient.js';
import { isQueueOverloaded, scheduleTvPrefetchJobs } from './backgroundPrefetch.js';

const app = express();
app.use(express.json());

function parsePositiveIntEnv(value: string | undefined, defaultValue: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

const PORT = Number(process.env.PORT || 3000);
const MAX_WORKERS = parsePositiveIntEnv(process.env.MAX_WORKERS, 2);
const MAX_QUEUE_SIZE = parsePositiveIntEnv(process.env.MAX_QUEUE_SIZE, 25);
const DIRECT_REQUEST_PRIORITY = parsePositiveIntEnv(process.env.DIRECT_REQUEST_PRIORITY, 10);
const BACKGROUND_PREFETCH_COUNT = parsePositiveIntEnv(process.env.BACKGROUND_PREFETCH_COUNT, 2);
const BACKGROUND_JOB_PRIORITY = parsePositiveIntEnv(process.env.BACKGROUND_JOB_PRIORITY, 1);
const EFFECTIVE_BACKGROUND_PRIORITY = DIRECT_REQUEST_PRIORITY > 1
    ? Math.min(BACKGROUND_JOB_PRIORITY, DIRECT_REQUEST_PRIORITY - 1)
    : 1;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const backgroundJobKeys = new Set<string>();
const queue = new PQueue({ concurrency: process.env.VERCEL ? 1 : MAX_WORKERS });
let databaseReady: Promise<void> | undefined;
function prepareDatabase(): Promise<void> {
    if (!databaseReady) databaseReady = initDatabase().catch(error => { databaseReady = undefined; throw error; });
    return databaseReady;
}
if (!process.env.VERCEL && pool) {
    setInterval(() => { void runCacheCleanup().catch(console.error); }, CLEANUP_INTERVAL_MS).unref();
}
app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', cache: pool ? 'postgres' : 'memory', browser: 'lazy', mediaProxy: false });
});

app.get('/', async (req: Request, res: Response): Promise<any> => {
    const { tmdbId, season, episode } = req.query;

    if (!tmdbId) {
        return res.status(400).json({ error: "Missing tmdbId!" });
    }
    if ((season && !episode) || (!season && episode)) {
        return res.status(400).json({ error: "For TV shows, both season and episode need to be included!" });
    }

    try {
        const tmdbIdStr = String(tmdbId);
        const tmdbNumeric = Number(tmdbIdStr);

        if (!Number.isInteger(tmdbNumeric) || tmdbNumeric <= 0) {
            return res.status(400).json({ error: "tmdbId must be a positive integer." });
        }

        let seasonNum: number | undefined;
        if (season !== undefined) {
            const parsedSeason = Number(season);
            if (!Number.isInteger(parsedSeason) || parsedSeason <= 0) {
                return res.status(400).json({ error: "season must be a positive integer." });
            }
            seasonNum = parsedSeason;
        }

        let episodeNum: number | undefined;
        if (episode !== undefined) {
            const parsedEpisode = Number(episode);
            if (!Number.isInteger(parsedEpisode) || parsedEpisode <= 0) {
                return res.status(400).json({ error: "episode must be a positive integer." });
            }
            episodeNum = parsedEpisode;
        }

        if (isQueueOverloaded(queue, MAX_QUEUE_SIZE)) {
            return res.status(529).json({
                error: 'Server is currently overloaded. Please retry shortly.'
            });
        }

        await prepareDatabase();
        const result = await queue.add(
            () => runScraper(tmdbIdStr, seasonNum, episodeNum),
            { priority: DIRECT_REQUEST_PRIORITY }
        );

        if (!process.env.VERCEL && seasonNum !== undefined && episodeNum !== undefined) {
            void scheduleTvPrefetchJobs({
                queue,
                tmdbId: tmdbIdStr,
                season: seasonNum,
                episode: episodeNum,
                prefetchCount: BACKGROUND_PREFETCH_COUNT,
                maxQueueSize: MAX_QUEUE_SIZE,
                backgroundPriority: EFFECTIVE_BACKGROUND_PRIORITY,
                inFlightJobs: backgroundJobKeys,
                resolveNextEpisodes: resolveNextTvEpisodes,
                runScrape: runScraper
            });
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.json({ ...result, format: 'hls' });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        console.error(`[Error] ${message}`);

        if (message.includes('Timeout')) {
            return res.status(408).json({ error: "Scraping timed out, no stream found." });
        }

        return res.status(404).json({ error: 'No playable HLS stream is available for this title and episode.', code: 'NO_HLS_STREAM' });
    }
});

export default app;
if (!process.env.VERCEL) {
    app.listen(PORT, () => { console.log(`StreamProvider running on http://localhost:${PORT}`); });
}
