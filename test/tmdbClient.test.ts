import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNextTvEpisodes } from '../src/tmdbClient.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TMDB_API_KEY;

function createJsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json'
        }
    });
}

test('resolveNextTvEpisodes spills over to the next season', { concurrency: false }, async () => {
    process.env.TMDB_API_KEY = 'test-key';

    const responses = new Map<string, Response>([
        ['https://api.themoviedb.org/3/tv/246?api_key=test-key', createJsonResponse(200, {
            id: 246,
            seasons: [{ season_number: 1 }, { season_number: 2 }]
        })],
        ['https://api.themoviedb.org/3/tv/246/season/1?api_key=test-key', createJsonResponse(200, {
            id: 1,
            season_number: 1,
            episodes: [{ episode_number: 1 }, { episode_number: 2 }]
        })],
        ['https://api.themoviedb.org/3/tv/246/season/2?api_key=test-key', createJsonResponse(200, {
            id: 2,
            season_number: 2,
            episodes: [{ episode_number: 1 }, { episode_number: 2 }]
        })]
    ]);

    globalThis.fetch = async (input: URL | RequestInfo): Promise<Response> => {
        const key = typeof input === 'string' ? input : input.toString();
        const response = responses.get(key);
        assert.ok(response, `Unexpected TMDB URL: ${key}`);
        return response;
    };

    const nextEpisodes = await resolveNextTvEpisodes('246', 1, 1, 2);
    assert.deepEqual(nextEpisodes, [
        { season: 1, episode: 2 },
        { season: 2, episode: 1 }
    ]);
});

test('resolveNextTvEpisodes returns empty array at end of known episodes', { concurrency: false }, async () => {
    process.env.TMDB_API_KEY = 'test-key';

    const responses = new Map<string, Response>([
        ['https://api.themoviedb.org/3/tv/246?api_key=test-key', createJsonResponse(200, {
            id: 246,
            seasons: [{ season_number: 1 }]
        })],
        ['https://api.themoviedb.org/3/tv/246/season/1?api_key=test-key', createJsonResponse(200, {
            id: 1,
            season_number: 1,
            episodes: [{ episode_number: 1 }, { episode_number: 2 }]
        })]
    ]);

    globalThis.fetch = async (input: URL | RequestInfo): Promise<Response> => {
        const key = typeof input === 'string' ? input : input.toString();
        const response = responses.get(key);
        assert.ok(response, `Unexpected TMDB URL: ${key}`);
        return response;
    };

    const nextEpisodes = await resolveNextTvEpisodes('246', 1, 2, 2);
    assert.deepEqual(nextEpisodes, []);
});

test.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
        delete process.env.TMDB_API_KEY;
    } else {
        process.env.TMDB_API_KEY = originalApiKey;
    }
});
