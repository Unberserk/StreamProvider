import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.VERCEL ? undefined : process.env.DATABASE_URL;

const databaseSslMode = (process.env.DATABASE_SSL_MODE ?? 'require').toLowerCase();
const sslConfig = databaseSslMode === 'disable' || databaseSslMode === 'off' || databaseSslMode === 'false'
    ? undefined
    : {
        rejectUnauthorized: databaseSslMode !== 'no-verify',
    };

const pool = databaseUrl ? new Pool({
    connectionString: databaseUrl,
    ssl: sslConfig,
}) : null;

export async function initDatabase(): Promise<void> {
    if (!pool) return;
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS stream_cache (
                id SERIAL PRIMARY KEY,
                tmdb_id VARCHAR(50) NOT NULL,
                season INTEGER,
                episode INTEGER,
                stream_url TEXT NOT NULL,
                referer TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tmdb_id, season, episode)
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_cache_lookup
            ON stream_cache(tmdb_id, season, episode)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_last_accessed
            ON stream_cache(last_accessed_at)
        `);
    } finally {
        client.release();
    }
}

export { pool };
