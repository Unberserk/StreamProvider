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
        for (const query of ['', '?url=https://example.com/a.ts', '?tmdbId=1429&season=1&t=30', '?tmdbId=1429&season=1&episode=1&t=-1', '?tmdbId=550&t=7']) {
            assert.equal((await fetch(base + '/preview' + query)).status, 400);
        }
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

test('Roku can list the backup and VaPlayer resumes priority after a failed lookup', async t => {
    process.env.VERCEL = '1';
    const { default: app } = await import('../src/index.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const realFetch = globalThis.fetch;
    const playlist = '#EXTM3U\n#EXTINF:6,\nsegment.ts';
    const vidzeeRequests: string[] = [];
    let vaPlayerAvailable = true;
    let vaPlayerLookups = 0;
    let primaryManifestRequests = 0;
    let previewRequests = 0;
    let primaryUrl = 'https://va.example/main.m3u8';
    let vidzeeAvailable = true;
    t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
        const url = new URL(input);
        if (url.origin === base) return realFetch(input, init);
        if (url.pathname.endsWith('/external_ids')) return Response.json({ imdb_id: 'tt1234567' });
        if (url.hostname === 'streamdata.vaplayer.ru') {
            vaPlayerLookups++;
            return vaPlayerAvailable
                ? Response.json({ data: { imdb_id: 'tt1234567', stream_urls: [primaryUrl] }, thumbnails_url: 'https://previews.example/thumbnail.vtt' })
                : new Response('', { status: 503 });
        }
        if (url.hostname === 'core.vidzee.wtf') {
            vidzeeRequests.push(url.pathname);
            assert.equal(url.searchParams.get('s'), 'dcloud');
            assert.equal(url.searchParams.get('e'), '0');
            return vidzeeAvailable
                ? Response.json({ url: 'https://cdn2.slowcloud.live/backup.m3u8' })
                : new Response('', { status: 502 });
        }
        if (url.hostname === 'cdn2.slowcloud.live') {
            assert.equal(new Headers(init?.headers).get('referer'), 'https://player.vidzee.wtf/');
            return new Response(playlist);
        }
        if (url.hostname === 'previews.example') {
            previewRequests++;
            return new Response('WEBVTT\n\n00:00:00 --> 00:00:30\nthumbnail.jpg#xywh=0,0,160,90');
        }
        assert.equal(url.hostname, 'va.example');
        primaryManifestRequests++;
        return new Response(playlist);
    });
    const originalKey = process.env.TMDB_API_KEY;
    process.env.TMDB_API_KEY = 'test-key';
    try {
        const lookup = async (query: string) => {
            const response = await fetch(base + '/?' + query);
            assert.equal(response.status, 200);
            return response.json();
        };
        const primary = await lookup('tmdbId=550&previews=off');
        assert.equal(primary.provider, 'VaPlayer');
        assert.equal(primary.format, 'hls');
        assert.equal(vidzeeRequests.length, 0);
        assert.equal(previewRequests, 0);
        assert.equal(primary.previewFrames, undefined);
        assert.equal(primaryManifestRequests, 1);
        assert.equal((await lookup('tmdbId=550')).previewFrames.length, 1);
        assert.equal(previewRequests, 1);
        assert.equal((await lookup('tmdbId=550&previews=off')).previewFrames, undefined);
        assert.equal(vaPlayerLookups, 2);
        primaryUrl = 'https://va.example/fresh.m3u8';
        assert.equal((await lookup('tmdbId=550&previews=off&refresh=1')).url, primaryUrl);
        assert.equal((await lookup('tmdbId=550&previews=off')).url, primaryUrl);
        assert.equal(vaPlayerLookups, 3);
        assert.equal(previewRequests, 1);

        const expanded = await lookup('tmdbId=1396&season=2&episode=3&sources=all');
        assert.deepEqual(expanded.streams.map((source: { provider: string }) => source.provider), ['VaPlayer', 'VidZee dcloud']);
        assert.equal(expanded.streams[1].format, 'hls');
        assert.equal(vidzeeRequests.at(-1), '/streams/tv/1396/2/3');

        vaPlayerAvailable = false;
        assert.equal((await lookup('tmdbId=1429&season=1&episode=2')).provider, 'VidZee dcloud');
        assert.equal(vidzeeRequests.at(-1), '/streams/tv/1429/1/2');
        vaPlayerAvailable = true;
        assert.equal((await lookup('tmdbId=1429&season=1&episode=2')).provider, 'VaPlayer');

        vidzeeAvailable = false;
        assert.deepEqual((await lookup('tmdbId=550&sources=all')).streams.map((source: { provider: string }) => source.provider), ['VaPlayer']);
        assert.equal(vidzeeRequests.at(-1), '/streams/movie/550');
    } finally {
        if (originalKey === undefined) delete process.env.TMDB_API_KEY;
        else process.env.TMDB_API_KEY = originalKey;
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
