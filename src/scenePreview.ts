import { spawn } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import PQueue from 'p-queue';
import { allowedStreamUrl } from './verifyStream.js';
import type { ScraperResult } from './scrapers/BaseScraper.js';
import type { PreviewFrame } from './previewFrames.js';

type Segment = { start: number; end: number; url: string };
type HlsIndex = { duration: number; segments: Segment[] };
const indexes = new Map<string, { value: HlsIndex; expires: number }>();
const pictures = new Map<string, { value: Buffer; expires: number }>();
const pending = new Map<string, Promise<Buffer>>();
const queue = new PQueue({ concurrency: 2 });
const TTL = 5 * 60 * 1000;

async function boundedDownload(url: string, referer: string | undefined, limit: number): Promise<{ url: string; bytes: Buffer }> {
    const signal = AbortSignal.timeout(8000);
    for (let hop = 0; hop < 4; hop++) {
        if (!allowedStreamUrl(url)) throw new Error('Unsupported media address');
        const response = await fetch(url, { headers: referer ? { Referer: referer } : {}, redirect: 'manual', signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            const location = response.headers.get('location');
            if (!location) break;
            url = new URL(location, url).href;
            continue;
        }
        if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Preview media unavailable'); }
        if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('Preview media too large'); }
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.length;
                if (size > limit) throw new Error('Preview media too large');
                chunks.push(part.value);
            }
        } finally { await reader.cancel().catch(() => {}); }
        return { url, bytes: Buffer.concat(chunks) };
    }
    throw new Error('Preview redirect unavailable');
}

export function parseHlsIndex(body: string, base: string): HlsIndex | null {
    if (!/^\s*#EXTM3U/.test(body) || !body.includes('#EXT-X-ENDLIST')) return null;
    // This fallback decodes ordinary MPEG-TS only. Encrypted and fragmented-MP4 playlists are not processed.
    if (/#EXT-X-(?:MAP|BYTERANGE):/.test(body) || /#EXT-X-KEY:(?!METHOD=NONE(?:,|\s|$))/.test(body)) return null;
    const segments: Segment[] = [];
    let start = 0, duration = 0;
    for (const raw of body.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('#EXTINF:')) {
            duration = Number(line.slice(8).split(',')[0]);
            if (!Number.isFinite(duration) || duration <= 0 || duration > 30) return null;
        } else if (line && !line.startsWith('#') && duration > 0) {
            let url: string;
            try { url = new URL(line, base).href; } catch { return null; }
            if (!allowedStreamUrl(url)) return null;
            segments.push({ start, end: start + duration, url });
            start += duration;
            duration = 0;
            if (segments.length > 40000 || start > 172800) return null;
        }
    }
    return segments.length ? { duration: start, segments } : null;
}

export async function loadHlsIndex(source: ScraperResult): Promise<HlsIndex | null> {
    const cached = indexes.get(source.url);
    if (cached && cached.expires > Date.now()) return cached.value;
    let url = source.url;
    for (let depth = 0; depth < 3; depth++) {
        const data = await boundedDownload(url, source.referer, 750000);
        const body = data.bytes.toString('utf8');
        const index = parseHlsIndex(body, data.url);
        if (index) {
            indexes.set(source.url, { value: index, expires: Date.now() + TTL });
            while (indexes.size > 20) indexes.delete(indexes.keys().next().value!);
            return index;
        }
        const lines = body.split(/\r?\n/).map(line => line.trim());
        const variants: Array<{ url: string; bandwidth: number }> = [];
        for (let i = 0; i < lines.length - 1; i++) {
            if (!lines[i].startsWith('#EXT-X-STREAM-INF:') || !lines[i + 1] || lines[i + 1].startsWith('#')) continue;
            variants.push({ url: new URL(lines[i + 1], data.url).href, bandwidth: Number(lines[i].match(/\bBANDWIDTH=(\d+)/)?.[1] || Infinity) });
        }
        variants.sort((a, b) => a.bandwidth - b.bandwidth);
        if (!variants.length) return null;
        url = variants[0].url;
    }
    return null;
}

export function generatedPreviewFrames(duration: number, id: string, season?: number, episode?: number): PreviewFrame[] {
    const result: PreviewFrame[] = [];
    for (let start = 0; start < duration && result.length < 4000; start += 30) {
        const url = new URL('https://stream-provider.vercel.app/preview');
        url.searchParams.set('tmdbId', id);
        if (season !== undefined && episode !== undefined) {
            url.searchParams.set('season', String(season)); url.searchParams.set('episode', String(episode));
        }
        url.searchParams.set('t', String(start));
        result.push({ start, end: Math.min(start + 30, duration), url: url.href, x: 0, y: 0, width: 240, height: 136 });
    }
    return result;
}

export async function generatedPreviewMetadata(source: ScraperResult, id: string, season?: number, episode?: number): Promise<PreviewFrame[]> {
    try {
        const index = await loadHlsIndex(source);
        return index ? generatedPreviewFrames(index.duration, id, season, episode) : [];
    } catch { return []; }
}

async function decodeFrame(bytes: Buffer): Promise<Buffer> {
    // FFmpeg reads only the bounded segment supplied on stdin; network and local-file input protocols are disabled.
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-protocol_whitelist', 'pipe', '-f', 'mpegts', '-i', 'pipe:0', '-map', '0:v:0', '-frames:v', '1', '-an', '-vf', 'scale=240:136:force_original_aspect_ratio=decrease,pad=240:136:(ow-iw)/2:(oh-ih)/2', '-threads', '1', '-q:v', '5', '-f', 'image2pipe', 'pipe:1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        let length = 0;
        const timeout = setTimeout(() => child.kill(), 6000);
        child.stdout.on('data', (chunk: Buffer) => { length += chunk.length; if (length > 100000) child.kill(); else chunks.push(chunk); });
        child.stderr.on('data', () => {});
        child.stdin.on('error', () => {});
        child.on('error', error => { clearTimeout(timeout); reject(error); });
        child.on('close', code => {
            clearTimeout(timeout);
            const picture = Buffer.concat(chunks);
            if (code === 0 && length <= 100000 && picture[0] === 255 && picture[1] === 216) resolve(picture);
            else reject(new Error('Preview frame could not be decoded'));
        });
        child.stdin.end(bytes);
    });
}

export async function renderScenePreview(source: ScraperResult, key: string, time: number): Promise<Buffer> {
    const cached = pictures.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const current = pending.get(key);
    if (current) return current;
    if (queue.size >= 4) throw new Error('Preview queue busy');
    const task = queue.add(async () => {
        const index = await loadHlsIndex(source);
        const segment = index?.segments.find(segment => time >= segment.start && time < segment.end);
        if (!segment) throw new Error('Preview time is outside this episode');
        const data = await boundedDownload(segment.url, source.referer, 3 * 1024 * 1024);
        if (data.bytes[0] !== 0x47 || data.bytes[188] !== 0x47) throw new Error('Preview segment is not MPEG-TS');
        const picture = await decodeFrame(data.bytes);
        pictures.set(key, { value: picture, expires: Date.now() + TTL });
        while (pictures.size > 80) pictures.delete(pictures.keys().next().value!);
        return picture;
    }).then(picture => picture!);
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
}
