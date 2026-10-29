import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreviewFrames, loadPreviewFrames } from '../src/previewFrames.js';

test('WebVTT sprite cues preserve scene times, resolve relative images and retain exact crop coordinates', () => {
    const frames = parsePreviewFrames('WEBVTT\r\n\r\nscene-1\r\n00:00:00.000 --> 00:00:30.500\r\n/static/one.jpg#xywh=0,0,160,90\r\n\r\n00:30.500 --> 01:00.000 align:start\r\n../two.jpg#xywh=160,90,160,90\n', 'https://images.example/a/b/timeline.vtt');
    assert.deepEqual(frames, [
        { start: 0, end: 30.5, url: 'https://images.example/static/one.jpg', x: 0, y: 0, width: 160, height: 90 },
        { start: 30.5, end: 60, url: 'https://images.example/a/two.jpg', x: 160, y: 90, width: 160, height: 90 },
    ]);
});

test('Malformed, private, overlapping and excessive sprite cues cannot become previews', () => {
    const frames = parsePreviewFrames('WEBVTT\n\n00:00:00 --> 00:00:30\na.jpg#xywh=0,0,160,90\n\n00:00:20 --> 00:00:40\nb.jpg#xywh=0,0,160,90\n\n00:00:40 --> 00:00:50\nhttps://127.0.0.1/a.jpg#xywh=0,0,160,90\n\n00:00:50 --> 00:01:00\nc.jpg#xywh=0,0,999999,90\n', 'https://images.example/t.vtt');
    assert.equal(frames.length, 1);
    assert.equal(parsePreviewFrames('<html>error</html>', 'https://images.example/t.vtt').length, 0);
});

test('Unavailable thumbnail files are optional and cannot stop movie playback', async () => {
    const original = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response('missing', { status: 404 });
        assert.deepEqual(await loadPreviewFrames('https://images.example/a.vtt', 'https://player.example/'), []);
        globalThis.fetch = async () => { throw new Error('Offline'); };
        assert.deepEqual(await loadPreviewFrames('https://images.example/a.vtt', 'https://player.example/'), []);
    } finally { globalThis.fetch = original; }
});
