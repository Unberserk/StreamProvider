import { allowedStreamUrl } from './verifyStream.js';

export type PreviewFrame = { start: number; end: number; url: string; x: number; y: number; width: number; height: number };

function timestamp(value: string): number {
    const match = value.match(/^(?:(\d+):)?(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return NaN;
    return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number((match[4] || '').padEnd(3, '0')) / 1000;
}

export function parsePreviewFrames(body: string, base: string): PreviewFrame[] {
    if (!/^\uFEFF?WEBVTT(?:\s|$)/.test(body) || !allowedStreamUrl(base)) return [];
    const frames: PreviewFrame[] = [];
    for (const block of body.replace(/\r/g, '').split(/\n\s*\n/)) {
        const lines = block.split('\n').map(line => line.trim());
        const index = lines.findIndex(line => line.includes('-->'));
        if (index < 0 || !lines[index + 1]) continue;
        const times = lines[index].split(/\s+-->\s+/);
        const start = timestamp(times[0]), end = timestamp((times[1] || '').split(/\s/)[0]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 172800) continue;
        try {
            const image = new URL(lines[index + 1], base);
            const crop = image.hash.match(/^#xywh=(\d+),(\d+),(\d+),(\d+)$/);
            if (!crop) continue;
            const [x, y, width, height] = crop.slice(1).map(Number);
            image.hash = '';
            if (!allowedStreamUrl(image.href) || !/\.(jpe?g|png|webp)$/i.test(image.pathname)) continue;
            if (width < 1 || height < 1 || width > 1024 || height > 1024 || x + width > 4096 || y + height > 4096) continue;
            frames.push({ start, end, url: image.href, x, y, width, height });
            if (frames.length >= 4000) break;
        } catch { /* Ignore malformed thumbnail cues; playback remains available. */ }
    }
    let lastEnd = -1;
    return frames.sort((a, b) => a.start - b.start).filter(frame => {
        if (frame.start < lastEnd) return false;
        lastEnd = frame.end;
        return true;
    });
}

export async function loadPreviewFrames(url: unknown, referer: string): Promise<PreviewFrame[]> {
    if (typeof url !== 'string' || !allowedStreamUrl(url)) return [];
    try {
        const response = await fetch(url, { headers: { Referer: referer }, redirect: 'error', signal: AbortSignal.timeout(3000) });
        if (!response.ok || !response.body) { await response.body?.cancel(); return []; }
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let bytes = 0, text = '';
        try {
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                bytes += part.value.length;
                if (bytes > 750000) return [];
                text += decoder.decode(part.value, { stream: true });
            }
            return parsePreviewFrames(text + decoder.decode(), url);
        } finally { await reader.cancel().catch(() => {}); }
    } catch { return []; }
}
