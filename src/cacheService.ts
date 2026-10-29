import { pool } from './database.js';
import type { ScraperResult } from './scrapers/BaseScraper.js';
import { getMemoryStream, setMemoryStream, deleteMemoryStream } from './memoryCache.js';

const CACHE_MAX_AGE_DAYS = 30;
const MAX_CACHE_ROWS = 1_000_000;

export async function getCachedStream(
    tmdbId: string,
    season?: number,
    episode?: number
): Promise<ScraperResult | null> {
    if (!pool) return getMemoryStream(tmdbId, season, episode);
    const result = await pool.query(
        `SELECT stream_url, referer FROM stream_cache
         WHERE tmdb_id = $1 AND season IS NOT DISTINCT FROM $2 AND episode IS NOT DISTINCT FROM $3`,
        [tmdbId, season ?? null, episode ?? null]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return {
        url: result.rows[0].stream_url,
        referer: result.rows[0].referer ?? undefined
    };
}

export async function updateLastAccessed(
    tmdbId: string,
    season?: number,
    episode?: number
): Promise<void> {
    if (!pool) return;
    await pool.query(
        `UPDATE stream_cache SET last_accessed_at = CURRENT_TIMESTAMP
         WHERE tmdb_id = $1 AND season IS NOT DISTINCT FROM $2 AND episode IS NOT DISTINCT FROM $3`,
        [tmdbId, season ?? null, episode ?? null]
    );
}

export async function setCachedStream(
    tmdbId: string,
    season: number | undefined,
    episode: number | undefined,
    data: ScraperResult
): Promise<void> {
    if (!pool) { setMemoryStream(tmdbId, season, episode, data); return; }
    await pool.query(
        `INSERT INTO stream_cache (tmdb_id, season, episode, stream_url, referer, last_accessed_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (tmdb_id, season, episode)
         DO UPDATE SET stream_url = $4, referer = $5, last_accessed_at = CURRENT_TIMESTAMP`,
        [tmdbId, season ?? null, episode ?? null, data.url, data.referer ?? null]
    );
}

export async function invalidateCache(
    tmdbId: string,
    season?: number,
    episode?: number
): Promise<void> {
    if (!pool) { deleteMemoryStream(tmdbId, season, episode); return; }
    await pool.query(
        `DELETE FROM stream_cache
         WHERE tmdb_id = $1 AND season IS NOT DISTINCT FROM $2 AND episode IS NOT DISTINCT FROM $3`,
        [tmdbId, season ?? null, episode ?? null]
    );
}

export async function cleanupStaleCache(): Promise<number> {
    if (!pool) return 0;
    const result = await pool.query(
        `DELETE FROM stream_cache
         WHERE last_accessed_at < NOW() - INTERVAL '${CACHE_MAX_AGE_DAYS} days'
         RETURNING id`
    );

    return result.rowCount ?? 0;
}

export async function enforceMaxCacheSize(): Promise<number> {
    if (!pool) return 0;
    const countResult = await pool.query('SELECT COUNT(*) as count FROM stream_cache');
    const count = parseInt(countResult.rows[0].count, 10);

    if (count <= MAX_CACHE_ROWS) {
        return 0;
    }

    const excessRows = count - MAX_CACHE_ROWS;
    const result = await pool.query(
        `DELETE FROM stream_cache
         WHERE id IN (
             SELECT id FROM stream_cache
             ORDER BY last_accessed_at ASC
             LIMIT $1
         )
         RETURNING id`,
        [excessRows]
    );

    return result.rowCount ?? 0;
}

export async function runCacheCleanup(): Promise<void> {
    await cleanupStaleCache();
    await enforceMaxCacheSize();
}
