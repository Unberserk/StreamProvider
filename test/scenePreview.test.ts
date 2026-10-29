import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHlsIndex, generatedPreviewFrames, loadHlsIndex, renderScenePreview } from '../src/scenePreview.js';

test('Episode preview index uses real segment durations and resolves exact media URLs', () => {
    const index = parseHlsIndex('#EXTM3U\n#EXTINF:5.005,\nfirst.ts\n#EXTINF:4.995,\n/second.ts\n#EXT-X-ENDLIST', 'https://cdn.example/show/index.m3u8');
    assert.deepEqual(index, { duration: 10, segments: [
        { start: 0, end: 5.005, url: 'https://cdn.example/show/first.ts' },
        { start: 5.005, end: 10, url: 'https://cdn.example/second.ts' },
    ] });
    for (const value of [
        '#EXTM3U\n#EXTINF:5,\na.ts',
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:5,\na.ts\n#EXT-X-ENDLIST',
        '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:5,\na.ts\n#EXT-X-ENDLIST',
        '#EXTM3U\n#EXTINF:5000,\na.ts\n#EXT-X-ENDLIST',
        '#EXTM3U\n#EXTINF:5,\nhttps://127.0.0.1/a.ts\n#EXT-X-ENDLIST',
    ]) assert.equal(parseHlsIndex(value, 'https://cdn.example/index.m3u8'), null);
});

test('Generated scene URLs remain tied to the exact TV/anime season and episode', () => {
    const frames = generatedPreviewFrames(65, '1429', 2, 3);
    assert.deepEqual(frames.map(frame => [frame.start, frame.end]), [[0,30],[30,60],[60,65]]);
    const url = new URL(frames[2].url);
    assert.equal(url.origin, 'https://stream-provider.vercel.app');
    assert.equal(url.pathname, '/preview');
    assert.equal(url.searchParams.get('tmdbId'), '1429');
    assert.equal(url.searchParams.get('season'), '2');
    assert.equal(url.searchParams.get('episode'), '3');
    assert.equal(url.searchParams.get('t'), '60');
    assert.equal(frames[0].width, 240);
    assert.equal(new URL(generatedPreviewFrames(1, '550')[0].url).searchParams.has('season'), false);
});

test('Preview decoding selects the lowest-bandwidth variant and rejects HTML masquerading as video', async () => {
    const original = globalThis.fetch, seen: string[] = [];
    const source = { url: 'https://cdn.example/preview-test/master.m3u8', referer: 'https://player.example/' };
    try {
        globalThis.fetch = async (input, init) => {
            const url = String(input); seen.push(url);
            assert.equal(new Headers(init?.headers).get('referer'), source.referer);
            if (url.endsWith('/master.m3u8')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=9000000\nhd.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=300000\nsd.m3u8');
            if (url.endsWith('/sd.m3u8')) return new Response('#EXTM3U\n#EXTINF:5,\na.ts\n#EXT-X-ENDLIST');
            return new Response('<html>not video</html>');
        };
        assert.equal((await loadHlsIndex(source))?.duration, 5);
        assert.equal(seen.some(url => url.endsWith('/hd.m3u8')), false);
        await assert.rejects(renderScenePreview(source, 'bad-html-media', 0), /not MPEG-TS/);
    } finally { globalThis.fetch = original; }
});
