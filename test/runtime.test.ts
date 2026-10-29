import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

test('Vercel health and invalid requests work without a database or browser startup', async () => {
    process.env.VERCEL = '1';
    process.env.DATABASE_URL = 'postgres://unused.invalid/no-database';
    const { default: app } = await import('../src/index.js');
    const { pool } = await import('../src/database.js');
    assert.equal(pool, null);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
        const response = await fetch(base + '/health');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok', cache: 'memory', browser: 'lazy', mediaProxy: false });
        for (const query of ['', '?tmdbId=bad', '?tmdbId=550&season=1', '?tmdbId=550&season=0&episode=1']) {
            const invalid = await fetch(base + '/' + query);
            assert.equal(invalid.status, 400);
        }
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
