import test from 'node:test';
import assert from 'node:assert/strict';
import { VaPlayerScraper } from '../src/scrapers/VaPlayer.js';

test('VaPlayer translates TMDB series to IMDb and preserves the requested episode and Referer', async () => {
    const original = globalThis.fetch;
    process.env.TMDB_API_KEY = 'test-key';
    const requests: string[] = [];
    try {
        globalThis.fetch = async (input, init) => {
            const url = String(input); requests.push(url);
            if (url.includes('/external_ids')) return Response.json({ imdb_id: 'tt2560140' });
            if (url.includes('/api.php')) {
                const parsed = new URL(url);
                assert.equal(parsed.searchParams.get('imdb'), 'tt2560140');
                assert.equal(parsed.searchParams.get('type'), 'tv');
                assert.equal(parsed.searchParams.get('season'), '2');
                assert.equal(parsed.searchParams.get('episode'), '7');
                return Response.json({ data: { imdb_id: 'tt2560140', stream_urls: ['https://cdn.example/episode.m3u8'] }, thumbnails_url: 'https://images.example/episode.vtt' });
            }
            assert.equal(new Headers(init?.headers).get('referer'), 'https://nextgencloudfabric.com/');
            if (url.endsWith('.vtt')) return new Response('WEBVTT\n\n00:00:00 --> 00:00:30\nepisode.jpg#xywh=0,0,160,90');
            return new Response('#EXTM3U\n#EXTINF:6,\nsegment.ts');
        };
        const result = await new VaPlayerScraper().extractStream('1429', 2, 7);
        assert.equal(result.url, 'https://cdn.example/episode.m3u8');
        assert.equal(result.provider, 'VaPlayer');
        assert.equal(result.previewFrames?.[0].url, 'https://images.example/episode.jpg');
        assert.match(requests[0], /\/tv\/1429\/external_ids/);
    } finally { globalThis.fetch = original; delete process.env.TMDB_API_KEY; }
});

test('VaPlayer rejects another title instead of playing substitute content', async () => {
    const original = globalThis.fetch;
    process.env.TMDB_API_KEY = 'test-key';
    try {
        globalThis.fetch = async input => String(input).includes('/external_ids')
            ? Response.json({ imdb_id: 'tt0137523' })
            : Response.json({ data: { imdb_id: 'tt0000000', stream_urls: ['https://cdn.example/wrong.m3u8'] } });
        await assert.rejects(new VaPlayerScraper().extractStream('550'), /different title/);
    } finally { globalThis.fetch = original; delete process.env.TMDB_API_KEY; }
});
