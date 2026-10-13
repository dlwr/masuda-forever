const ORIGIN = 'https://anond.hatelabo.jp';
const ARTICLE_PATH = /^\/\d{14}$/;
const ARTICLE_HREF = /^\/\d{14}(?:[?#].*)?$/;

const HOUR = 3600;
const DAY = 24 * HOUR;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const ARTICLE_FETCH_CACHE: RequestInitCfProperties = {
	cacheEverything: true,
	cacheTtlByStatus: { '200-299': 6 * HOUR, '404': DAY, '500-599': 0 },
};

const ASSET_FETCH_CACHE: RequestInitCfProperties = { cacheEverything: true, cacheTtl: 365 * DAY };

export function isArticlePath(pathname: string): boolean {
	return ARTICLE_PATH.test(pathname);
}

export function isMirroredPath(pathname: string): boolean {
	return isArticlePath(pathname) || pathname.startsWith('/assets/');
}

export function rewriteHref(href: string): string {
	const local = href.startsWith(ORIGIN + '/') ? href.slice(ORIGIN.length) : href;
	if (!local.startsWith('/') || local.startsWith('//')) return href;
	return ARTICLE_HREF.test(local) ? local : ORIGIN + local;
}

export function rewriteStaticAssetUrl(url: string): string {
	return url.startsWith('/assets/') ? ORIGIN + url : url;
}

const STYLE = `<style>
#mf-banner{position:sticky;top:0;z-index:2147483647;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;justify-content:space-between;padding:8px 12px;background:#b3261e;color:#fff;font:bold 14px/1.4 sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3)}
#mf-banner a{color:#fff;text-decoration:underline}
#mf-banner .mf-actions{display:flex;gap:12px;align-items:center}
#mf-next{border:1px solid #fff;background:transparent;color:#fff;font:bold 14px sans-serif;padding:4px 10px;border-radius:3px;cursor:pointer}
#mf-pull{margin:24px 0 0;padding:40px 12px 120px;text-align:center;font:14px/1.6 sans-serif;color:#666;border-top:4px solid #b3261e;background:linear-gradient(to right,#f2d4d1 var(--mf-progress,0%),transparent var(--mf-progress,0%))}
</style>`;

const SCRIPT = `<script>
(() => {
	const QUEUE_KEY = 'mf-queue';
	const SKIP_KEY = 'mf-skips';
	const storage = (fn, fallback) => {
		try {
			return fn(sessionStorage);
		} catch {
			return fallback;
		}
	};
	const readQueue = () => storage((s) => JSON.parse(s.getItem(QUEUE_KEY) || '[]'), []);
	const writeQueue = (queue) => storage((s) => s.setItem(QUEUE_KEY, JSON.stringify(queue)));
	let moving = false;
	const next = async () => {
		if (moving) return;
		moving = true;
		let queue = readQueue();
		if (queue.length === 0) {
			try {
				const response = await fetch('/api/next');
				if (response.ok) queue = await response.json();
			} catch {}
		}
		const path = queue.shift();
		writeQueue(queue);
		location.assign(path || '/random');
	};
	const banner = document.getElementById('mf-banner');
	if (banner.dataset.missing) {
		const skips = Number(storage((s) => s.getItem(SKIP_KEY), 0)) + 1;
		storage((s) => s.setItem(SKIP_KEY, String(skips)));
		if (skips <= 5) return void next();
	} else {
		storage((s) => s.removeItem(SKIP_KEY));
	}
	document.getElementById('mf-next').addEventListener('click', next);
	const pull = document.getElementById('mf-pull');
	const THRESHOLD = 600;
	let pulled = 0;
	let touchY;
	const atBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
	const add = (delta) => {
		pulled = Math.max(0, pulled + delta);
		pull.style.setProperty('--mf-progress', Math.min(100, (pulled / THRESHOLD) * 100) + '%');
		if (pulled >= THRESHOLD) next();
	};
	const reset = () => add(-pulled);
	addEventListener('wheel', (event) => (atBottom() && event.deltaY > 0 ? add(event.deltaY) : reset()), { passive: true });
	addEventListener('touchstart', (event) => (touchY = event.touches[0].clientY), { passive: true });
	addEventListener('touchmove', (event) => {
		const y = event.touches[0].clientY;
		if (atBottom() && touchY !== undefined && y < touchY) add((touchY - y) * 3);
		touchY = y;
	}, { passive: true });
	addEventListener('touchend', () => {
		touchY = undefined;
		if (pulled < THRESHOLD) reset();
	});
	addEventListener('keydown', (event) => {
		if (event.key === 'n' && !event.isComposing && !(event.target instanceof HTMLInputElement)) next();
	});
})();
</script>`;

function banner(originalUrl: string, missing: boolean): string {
	return `<div id="mf-banner"${missing ? ' data-missing="1"' : ''}>
<span>これは masuda-forever による非公式ミラーです（はてな匿名ダイアリー本家ではありません）</span>
<span class="mf-actions"><a href="${originalUrl}">本家で開く</a><button type="button" id="mf-next">次のmasuda</button></span>
</div>`;
}

const PULL = `<div id="mf-pull">さらに下へスクロールすると次のmasudaへ（n キーでも移動）</div>`;

function rewriteAttribute(attribute: string, rewrite: (value: string) => string): HTMLRewriterElementContentHandlers {
	return {
		element(element) {
			const value = element.getAttribute(attribute);
			if (value !== null) element.setAttribute(attribute, rewrite(value));
		},
	};
}

export async function mirror(pathname: string, search: string, fetcher: Fetcher = fetch): Promise<Response> {
	const originalUrl = ORIGIN + pathname;
	const isAsset = pathname.startsWith('/assets/');
	const upstream = await fetcher(originalUrl + search, {
		headers: { 'User-Agent': 'masuda-forever-mirror' },
		cf: isAsset ? ASSET_FETCH_CACHE : ARTICLE_FETCH_CACHE,
	});

	const headers = new Headers({ 'X-Robots-Tag': 'noindex' });
	for (const name of ['content-type', 'last-modified', 'etag']) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set('cache-control', isAsset ? (upstream.headers.get('cache-control') ?? `public, max-age=${DAY}`) : `private, max-age=${HOUR}`);

	const response = new Response(upstream.body, { status: upstream.status, headers });
	if (!headers.get('content-type')?.includes('text/html')) return response;

	return new HTMLRewriter()
		.on('title', {
			element(element) {
				element.prepend('[非公式ミラー] ');
			},
		})
		.on('head', {
			element(element) {
				element.append(`<meta name="robots" content="noindex,nofollow">${STYLE}`, { html: true });
			},
		})
		.on('body', {
			element(element) {
				element.prepend(banner(originalUrl, upstream.status === 404), { html: true });
				element.append(PULL + SCRIPT, { html: true });
			},
		})
		.on('a[href]', rewriteAttribute('href', rewriteHref))
		.on('form[action]', rewriteAttribute('action', rewriteHref))
		.on('button[formaction]', rewriteAttribute('formaction', rewriteHref))
		.on('link[href]', rewriteAttribute('href', rewriteStaticAssetUrl))
		.on('img[src]', rewriteAttribute('src', rewriteStaticAssetUrl))
		.transform(response);
}
