import test from 'node:test';
import assert from 'node:assert/strict';
import { getMemoryStream, setMemoryStream, deleteMemoryStream } from '../src/memoryCache.js';

test('Memory cache isolates episodes, copies values and expires signed stream URLs', () => {
    const clock = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        setMemoryStream('550', 1, 2, { url: 'https://media.example/2.m3u8' });
        assert.equal(getMemoryStream('550', 1, 1), null);
        const entry = getMemoryStream('550', 1, 2)!;
        entry.url = 'https://media.example/changed.m3u8';
        assert.equal(getMemoryStream('550', 1, 2)?.url, 'https://media.example/2.m3u8');
        now += 300001;
        assert.equal(getMemoryStream('550', 1, 2), null);
        setMemoryStream('550', undefined, undefined, { url: 'https://media.example/movie.m3u8' });
        deleteMemoryStream('550');
        assert.equal(getMemoryStream('550'), null);
    } finally { Date.now = clock; }
});
