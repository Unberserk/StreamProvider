import type { ScraperResult } from './scrapers/BaseScraper.ts';

const entries = new Map<string, { value: ScraperResult; expires: number }>();
const ttl = 5 * 60 * 1000;
const limit = 100;
const key = (id: string, season?: number, episode?: number) => `${id}:${season ?? 0}:${episode ?? 0}`;

export function getMemoryStream(id: string, season?: number, episode?: number): ScraperResult | null {
    const k = key(id, season, episode), entry = entries.get(k);
    if (!entry) return null;
    if (entry.expires <= Date.now()) { entries.delete(k); return null; }
    return { ...entry.value };
}
export function setMemoryStream(id: string, season: number | undefined, episode: number | undefined, value: ScraperResult): void {
    const k = key(id, season, episode);
    entries.delete(k);
    entries.set(k, { value: { ...value }, expires: Date.now() + ttl });
    while (entries.size > limit) entries.delete(entries.keys().next().value!);
}
export function deleteMemoryStream(id: string, season?: number, episode?: number): void {
    entries.delete(key(id, season, episode));
}
