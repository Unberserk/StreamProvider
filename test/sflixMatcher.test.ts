import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeTitle,
    selectBestEpisodeOption,
    selectBestSearchCandidate,
    selectBestSeasonOption
} from '../src/scrapers/sflixMatcher.js';

test('normalizeTitle strips punctuation and normalizes spacing', () => {
    assert.equal(
        normalizeTitle("Avatar: The Last Airbender (2024)"),
        'avatar the last airbender 2024'
    );
});

test('selectBestSearchCandidate picks closest valid year match', () => {
    const result = selectBestSearchCandidate(
        [
            { index: 0, title: 'Avatar: The Last Airbender', year: 2024, href: '/tv/new' },
            { index: 1, title: 'Avatar: The Last Airbender', year: 2005, href: '/tv/original' }
        ],
        'Avatar: The Last Airbender',
        2005
    );

    assert.ok(result);
    assert.equal(result.href, '/tv/original');
});

test('selectBestSearchCandidate rejects out-of-tolerance years', () => {
    const result = selectBestSearchCandidate(
        [{ index: 0, title: 'Gravity Falls', year: 2020, href: '/tv/wrong' }],
        'Gravity Falls',
        2012
    );

    assert.equal(result, null);
});

test('selectBestSeasonOption matches by season name before number/index', () => {
    const result = selectBestSeasonOption(
        [
            { index: 0, text: 'Season 1', targetId: 'ss-episodes-1' },
            { index: 1, text: 'Book One: Water', targetId: 'ss-episodes-2' }
        ],
        1,
        'Book One: Water'
    );

    assert.ok(result);
    assert.equal(result.targetId, 'ss-episodes-2');
});

test('selectBestEpisodeOption prefers exact episode number', () => {
    const result = selectBestEpisodeOption(
        [
            { index: 0, id: 'episode-1', number: 2, title: 'Episode 2: The Firebending Masters' },
            { index: 1, id: 'episode-2', number: 1, title: 'Episode 1: The Boy in the Iceberg' }
        ],
        1,
        'The Boy in the Iceberg'
    );

    assert.ok(result);
    assert.equal(result.id, 'episode-2');
});

test('selectBestEpisodeOption falls back to title matching when number missing', () => {
    const result = selectBestEpisodeOption(
        [
            { index: 0, id: 'episode-a', number: null, title: 'The Boy in the Iceberg' },
            { index: 1, id: 'episode-b', number: null, title: 'The Avatar Returns' }
        ],
        1,
        'The Boy in the Iceberg'
    );

    assert.ok(result);
    assert.equal(result.id, 'episode-a');
});
