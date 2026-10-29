import { chromium, type BrowserContext } from 'patchright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pendingContext: Promise<BrowserContext> | undefined;

async function launchContext(): Promise<BrowserContext> {
    const options: Parameters<typeof chromium.launchPersistentContext>[1] = {
        headless: true,
        viewport: { width: 1280, height: 720 },
        timeout: 30000,
    };
    if (process.env.VERCEL) {
        const { default: binary } = await import('@sparticuz/chromium');
        options.executablePath = await binary.executablePath();
        options.args = binary.args;
    } else if (process.env.BROWSER_EXECUTABLE_PATH) {
        options.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
    } else if (process.env.BROWSER_CHANNEL) {
        options.channel = process.env.BROWSER_CHANNEL;
    }
    const context = await chromium.launchPersistentContext(
        process.env.CHROME_DATA_DIR || join(tmpdir(), 'streamprovider-chrome'), options
    );
    context.on('close', () => { pendingContext = undefined; });
    return context;
}

export async function getBrowserContext(): Promise<BrowserContext> {
    if (!pendingContext) {
        pendingContext = launchContext().catch(error => {
            pendingContext = undefined;
            throw error;
        });
    }
    return pendingContext;
}

export async function closeBrowser(): Promise<void> {
    const pending = pendingContext;
    pendingContext = undefined;
    if (pending) await (await pending).close();
}
