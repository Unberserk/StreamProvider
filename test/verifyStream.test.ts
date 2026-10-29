import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedStreamUrl, verifyStreamUrl } from '../src/verifyStream.ts';

test('Stream verification rejects HTML, empty playlists, unsafe redirects and missing media', async () => {
    const original = globalThis.fetch;
    try {
        for (const body of ['<html>player</html>', '#EXTM3U\n', '#EXTM3U\n#EXTINF:6,\n', 'not a playlist']) {
            globalThis.fetch = async () => new Response(body);
            assert.equal(await verifyStreamUrl({ url: 'https://cdn.example/index.m3u8' }), false);
        }
        let calls = 0;
        globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); };
        assert.equal(await verifyStreamUrl({ url: 'https://cdn.example/index.m3u8' }), false);
        assert.equal(calls, 1);
        globalThis.fetch = async () => new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720.m3u8');
        assert.equal(await verifyStreamUrl({ url: 'https://cdn.example/signed?id=1' }), true);
    } finally { globalThis.fetch = original; }
});
test('Stream URLs reject credentials, private addresses and unsupported protocols', () => {
    for (const value of ['http://cdn.example/file.m3u8', 'https://user:pass@cdn.example/file.m3u8', 'https://[::1]/', 'https://[::ffff:7f00:1]/', 'https://10.0.0.1/', 'https://device.local/file.m3u8']) assert.equal(allowedStreamUrl(value), false, value);
    assert.equal(allowedStreamUrl('https://cdn.example/manifest.m3u8?token=opaque'), true);
});
