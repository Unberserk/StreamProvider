const TMDB_BASE_URL = (process.env.TMDB_BASE_URL ?? 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const TMDB_TIMEOUT_MS = Number(process.env.TMDB_TIMEOUT_MS ?? 7000);
const TMDB_MAX_RETRIES = Number(process.env.TMDB_MAX_RETRIES ?? 2);

export async function resolveTmdbImdbId(id: string, television: boolean): Promise<string> {
    const result = await fetchTmdb<{ imdb_id?: string }>(`/${television ? 'tv' : 'movie'}/${id}/external_ids`);
    if (!result.imdb_id || !/^tt\d+$/.test(result.imdb_id)) throw new Error('No IMDb match for this TMDB title');
    return result.imdb_id;
}

type TmdbMovieResponse = {
    id: number;
    title?: string;
    original_title?: string;
    release_date?: string;
};

type TmdbTvResponse = {
    id: number;
    name?: string;
    original_name?: string;
    first_air_date?: string;
    seasons?: Array<{ season_number: number; name?: string; episode_count?: number }>;
};

type TmdbEpisodeResponse = {
    id: number;
    episode_number: number;
    name?: string;
};

type TmdbSeasonResponse = {
    id: number;
    season_number: number;
    episodes?: Array<{ episode_number: number }>;
};

export type MovieLookupMetadata = {
    mediaType: 'movie';
    tmdbId: string;
    title: string;
    originalTitle?: string;
    releaseYear: number;
};

export type TvEpisodeLookupMetadata = {
    mediaType: 'tv';
    tmdbId: string;
    title: string;
    originalTitle?: string;
    releaseYear: number;
    seasonNumber: number;
    seasonName?: string;
    episodeNumber: number;
    episodeName?: string;
};

export type TvShowLookupMetadata = {
    mediaType: 'tv';
    tmdbId: string;
    title: string;
    originalTitle?: string;
    releaseYear: number;
};

export type LookupMetadata = MovieLookupMetadata | TvEpisodeLookupMetadata | TvShowLookupMetadata;

export type TvEpisodeCursor = {
    season: number;
    episode: number;
};

function getTmdbApiKey(): string {
    if (process.env.TMDB_READ_TOKEN?.trim()) return '';
    const key = process.env.TMDB_API_KEY?.trim();
    if (!key) {
        throw new Error('TMDB metadata access is missing. Set TMDB_API_KEY or TMDB_READ_TOKEN.');
    }
    return key;
}

function parseYear(dateValue: string | undefined): number | null {
    if (!dateValue) return null;
    const match = dateValue.match(/^(\d{4})/);
    if (!match) return null;
    const year = Number(match[1]);
    return Number.isFinite(year) ? year : null;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                accept: 'application/json',
                ...(process.env.TMDB_READ_TOKEN?.trim() ? { Authorization: `Bearer ${process.env.TMDB_READ_TOKEN.trim()}` } : {})
            }
        });
    } finally {
        clearTimeout(timeoutHandle);
    }
}

async function fetchTmdb<T>(path: string): Promise<T> {
    const apiKey = getTmdbApiKey();
    const url = `${TMDB_BASE_URL}${path}${apiKey ? `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(apiKey)}` : ''}`;

    let lastError: unknown;

    for (let attempt = 0; attempt <= TMDB_MAX_RETRIES; attempt += 1) {
        try {
            const response = await fetchWithTimeout(url, TMDB_TIMEOUT_MS);

            if (response.status === 404) {
                throw new Error('TMDB_NOT_FOUND');
            }

            if (!response.ok) {
                throw new Error(`TMDB_HTTP_${response.status}`);
            }

            return await response.json() as T;
        } catch (error) {
            lastError = error;

            if (error instanceof Error && error.message === 'TMDB_NOT_FOUND') {
                throw error;
            }

            if (attempt === TMDB_MAX_RETRIES) {
                break;
            }
        }
    }

    const message = lastError instanceof Error ? lastError.message : 'Unknown TMDB error';
    throw new Error(`TMDB_REQUEST_FAILED:${message}`);
}

async function resolveMovieMetadata(tmdbId: string): Promise<MovieLookupMetadata> {
    const movie = await fetchTmdb<TmdbMovieResponse>(`/movie/${encodeURIComponent(tmdbId)}`);
    const title = movie.title?.trim();
    const releaseYear = parseYear(movie.release_date);

    if (!title || !releaseYear) {
        throw new Error('TMDB_MOVIE_METADATA_INCOMPLETE');
    }

    return {
        mediaType: 'movie',
        tmdbId,
        title,
        originalTitle: movie.original_title?.trim() || undefined,
        releaseYear
    };
}

async function resolveTvEpisodeMetadata(
    tmdbId: string,
    seasonNumber: number,
    episodeNumber: number
): Promise<TvEpisodeLookupMetadata> {
    const [show, episode] = await Promise.all([
        fetchTmdb<TmdbTvResponse>(`/tv/${encodeURIComponent(tmdbId)}`),
        fetchTmdb<TmdbEpisodeResponse>(
            `/tv/${encodeURIComponent(tmdbId)}/season/${seasonNumber}/episode/${episodeNumber}`
        )
    ]);

    const title = show.name?.trim();
    const releaseYear = parseYear(show.first_air_date);

    if (!title || !releaseYear) {
        throw new Error('TMDB_TV_METADATA_INCOMPLETE');
    }

    return {
        mediaType: 'tv',
        tmdbId,
        title,
        originalTitle: show.original_name?.trim() || undefined,
        releaseYear,
        seasonNumber,
        seasonName: show.seasons?.find((entry) => entry.season_number === seasonNumber)?.name?.trim() || undefined,
        episodeNumber: episode.episode_number,
        episodeName: episode.name?.trim() || undefined
    };
}

async function resolveTvShowMetadata(tmdbId: string): Promise<TvShowLookupMetadata> {
    const show = await fetchTmdb<TmdbTvResponse>(`/tv/${encodeURIComponent(tmdbId)}`);
    const title = show.name?.trim();
    const releaseYear = parseYear(show.first_air_date);

    if (!title || !releaseYear) {
        throw new Error('TMDB_TV_METADATA_INCOMPLETE');
    }

    return {
        mediaType: 'tv',
        tmdbId,
        title,
        originalTitle: show.original_name?.trim() || undefined,
        releaseYear
    };
}

export async function resolveTmdbLookupMetadata(
    tmdbId: string,
    season?: number,
    episode?: number
): Promise<LookupMetadata> {
    if (season && episode) {
        return resolveTvEpisodeMetadata(tmdbId, season, episode);
    }

    try {
        return await resolveMovieMetadata(tmdbId);
    } catch (error) {
        if (!(error instanceof Error) || error.message !== 'TMDB_NOT_FOUND') {
            throw error;
        }
    }

    try {
        return await resolveTvShowMetadata(tmdbId);
    } catch (error) {
        if (!(error instanceof Error) || error.message !== 'TMDB_NOT_FOUND') {
            throw error;
        }
    }

    throw new Error('TMDB_NOT_FOUND');
}

export async function resolveNextTvEpisodes(
    tmdbId: string,
    season: number,
    episode: number,
    count: number
): Promise<TvEpisodeCursor[]> {
    if (!Number.isInteger(season) || season <= 0) {
        throw new Error('TMDB_INVALID_SEASON');
    }
    if (!Number.isInteger(episode) || episode <= 0) {
        throw new Error('TMDB_INVALID_EPISODE');
    }
    if (!Number.isInteger(count) || count <= 0) {
        return [];
    }

    const show = await fetchTmdb<TmdbTvResponse>(`/tv/${encodeURIComponent(tmdbId)}`);
    const seasonNumbers = (show.seasons ?? [])
        .map((entry) => entry.season_number)
        .filter((value) => Number.isInteger(value) && value > 0)
        .sort((a, b) => a - b);

    if (seasonNumbers.length === 0) {
        throw new Error('TMDB_TV_METADATA_INCOMPLETE');
    }
    if (!seasonNumbers.includes(season)) {
        throw new Error('TMDB_SEASON_NOT_FOUND');
    }

    const episodesBySeason = new Map<number, number[]>();
    const fetchSeasonEpisodes = async (seasonNumber: number): Promise<number[]> => {
        const cached = episodesBySeason.get(seasonNumber);
        if (cached) {
            return cached;
        }

        const seasonData = await fetchTmdb<TmdbSeasonResponse>(
            `/tv/${encodeURIComponent(tmdbId)}/season/${seasonNumber}`
        );
        const numbers = (seasonData.episodes ?? [])
            .map((entry) => entry.episode_number)
            .filter((value) => Number.isInteger(value) && value > 0)
            .sort((a, b) => a - b);
        episodesBySeason.set(seasonNumber, numbers);
        return numbers;
    };

    const currentSeasonEpisodes = await fetchSeasonEpisodes(season);
    if (!currentSeasonEpisodes.includes(episode)) {
        throw new Error('TMDB_EPISODE_NOT_FOUND');
    }

    const results: TvEpisodeCursor[] = [];
    const seasonStartIdx = seasonNumbers.indexOf(season);

    for (let i = seasonStartIdx; i < seasonNumbers.length && results.length < count; i += 1) {
        const seasonNumber = seasonNumbers[i];
        const episodeNumbers = await fetchSeasonEpisodes(seasonNumber);
        const minEpisodeNumber = seasonNumber === season ? episode + 1 : 1;

        for (const episodeNumber of episodeNumbers) {
            if (episodeNumber < minEpisodeNumber) {
                continue;
            }

            results.push({ season: seasonNumber, episode: episodeNumber });
            if (results.length >= count) {
                break;
            }
        }
    }

    return results;
}
