const ORIGIN = 'https://anond.hatelabo.jp';
const ARTICLE_PATH = /^\/\d{14}$/;
const ARTICLE_HREF = /^\/\d{14}(?:[?#].*)?$/;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function isMirroredPath(pathname: string): boolean {
	return ARTICLE_PATH.test(pathname) || pathname.startsWith('/assets/');
}

export function rewriteHref(href: string): string {
	const local = href.startsWith(ORIGIN + '/') ? href.slice(ORIGIN.length) : href;
	if (!local.startsWith('/') || local.startsWith('//')) return href;
	return ARTICLE_HREF.test(local) ? local : ORIGIN + local;
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
	const next = () => location.assign('/random');
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

function banner(originalUrl: string): string {
	return `<div id="mf-banner">
<span>これは masuda-forever による非公式ミラーです（はてな匿名ダイアリー本家ではありません）</span>
<span class="mf-actions"><a href="${originalUrl}">本家で開く</a><button type="button" id="mf-next">次のmasuda</button></span>
</div>`;
}

const PULL = `<div id="mf-pull">さらに下へスクロールすると次のmasudaへ（n キーでも移動）</div>`;

function rewriteAttribute(attribute: string): HTMLRewriterElementContentHandlers {
	return {
		element(element) {
			const value = element.getAttribute(attribute);
			if (value !== null) element.setAttribute(attribute, rewriteHref(value));
		},
	};
}

export async function mirror(pathname: string, search: string, fetcher: Fetcher = fetch): Promise<Response> {
	const originalUrl = ORIGIN + pathname;
	const upstream = await fetcher(originalUrl + search, {
		headers: { 'User-Agent': 'masuda-forever-mirror' },
		...(pathname.startsWith('/assets/') ? { cf: { cacheTtl: 86_400, cacheEverything: true } } : {}),
	});

	const headers = new Headers({ 'X-Robots-Tag': 'noindex' });
	for (const name of ['content-type', 'cache-control', 'last-modified', 'etag']) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}

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
				element.prepend(banner(originalUrl), { html: true });
				element.append(PULL + SCRIPT, { html: true });
			},
		})
		.on('a[href]', rewriteAttribute('href'))
		.on('form[action]', rewriteAttribute('action'))
		.on('button[formaction]', rewriteAttribute('formaction'))
		.transform(response);
}
