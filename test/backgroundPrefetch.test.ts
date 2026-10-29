import test from 'node:test';
import assert from 'node:assert/strict';
import { getQueueLoad, isQueueOverloaded, scheduleTvPrefetchJobs, type TvEpisodeTarget } from '../src/backgroundPrefetch.js';

type QueueTaskOptions = {
    priority?: number;
};

class FakeQueue {
    size = 0;
    pending = 0;
    addedPriorities: number[] = [];

    async add<T>(task: () => Promise<T>, options?: QueueTaskOptions): Promise<T> {
        this.addedPriorities.push(options?.priority ?? 0);
        return task();
    }
}

test('isQueueOverloaded returns true at threshold', () => {
    const queue = { size: 10, pending: 15 };
    assert.equal(getQueueLoad(queue), 25);
    assert.equal(isQueueOverloaded(queue, 25), true);
});

test('scheduleTvPrefetchJobs enqueues low-priority jobs and clears dedupe set', async () => {
    const queue = new FakeQueue();
    const inFlightJobs = new Set<string>();
    const executed: Array<[string, number, number]> = [];
    const episodes: TvEpisodeTarget[] = [
        { season: 1, episode: 2 },
        { season: 2, episode: 1 }
    ];

    await scheduleTvPrefetchJobs({
        queue,
        tmdbId: '246',
        season: 1,
        episode: 1,
        prefetchCount: 2,
        maxQueueSize: 25,
        backgroundPriority: 1,
        inFlightJobs,
        resolveNextEpisodes: async () => episodes,
        runScrape: async (tmdbId, season, episode) => {
            executed.push([tmdbId, season, episode]);
        }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(executed, [
        ['246', 1, 2],
        ['246', 2, 1]
    ]);
    assert.deepEqual(queue.addedPriorities, [1, 1]);
    assert.equal(inFlightJobs.size, 0);
});

test('scheduleTvPrefetchJobs skips enqueue when queue is overloaded', async () => {
    const queue = new FakeQueue();
    queue.size = 25;

    const executed: number[] = [];
    await scheduleTvPrefetchJobs({
        queue,
        tmdbId: '246',
        season: 1,
        episode: 1,
        prefetchCount: 2,
        maxQueueSize: 25,
        backgroundPriority: 1,
        inFlightJobs: new Set<string>(),
        logger: { error: () => undefined, warn: () => undefined },
        resolveNextEpisodes: async () => [{ season: 1, episode: 2 }],
        runScrape: async () => {
            executed.push(1);
        }
    });

    assert.deepEqual(queue.addedPriorities, []);
    assert.deepEqual(executed, []);
});

test('scheduleTvPrefetchJobs does not enqueue when no next episodes exist', async () => {
    const queue = new FakeQueue();
    await scheduleTvPrefetchJobs({
        queue,
        tmdbId: '246',
        season: 9,
        episode: 999,
        prefetchCount: 2,
        maxQueueSize: 25,
        backgroundPriority: 1,
        inFlightJobs: new Set<string>(),
        resolveNextEpisodes: async () => [],
        runScrape: async () => undefined
    });

    assert.deepEqual(queue.addedPriorities, []);
});
