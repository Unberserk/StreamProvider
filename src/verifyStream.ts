import { isIP } from 'node:net';
import type { ScraperResult } from './scrapers/BaseScraper.js';

export function allowedStreamUrl(value: string): boolean {
    try {
        const url = new URL(value), host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (url.protocol !== 'https:' || url.username || url.password) return false;
        if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
        if (isIP(host) === 4) {
            const [a, b] = host.split('.').map(Number);
            if ([0, 10, 127].includes(a) || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168) return false;
        }
        if (isIP(host) === 6 && (host === '::' || host === '::1' || /^(fc|fd|fe8|fe9|fea|feb|ff|::ffff:)/.test(host))) return false;
        return true;
    } catch { return false; }
}

export async function verifyStreamUrl(source: ScraperResult): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.STREAM_VERIFY_TIMEOUT_MS) || 5000);
    let url = source.url;
    try {
        for (let hop = 0; hop < 4; hop++) {
            if (!allowedStreamUrl(url)) return false;
            const response = await fetch(url, { redirect: 'manual', headers: source.referer ? { Referer: source.referer } : {}, signal: controller.signal });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                await response.body?.cancel();
                const location = response.headers.get('location');
                if (!location) return false;
                url = new URL(location, url).href;
                continue;
            }
            if (!response.ok || !response.body) { await response.body?.cancel(); return false; }
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let bytes = 0, body = '';
            try {
                while (true) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    bytes += chunk.value.length;
                    if (bytes > 512000) return false;
                    body += decoder.decode(chunk.value, { stream: true });
                }
                body += decoder.decode();
                return /^\s*#EXTM3U/.test(body) && /#EXT(?:INF|-X-STREAM-INF):/.test(body)
                    && body.split(/\r?\n/).some(line => line.trim() && !line.trim().startsWith('#'));
            } finally { await reader.cancel().catch(() => {}); }
        }
        return false;
    } catch { return false; }
    finally { clearTimeout(timer); }
}
