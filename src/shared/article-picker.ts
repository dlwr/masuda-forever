export type ArticleStatus = 'alive' | 'deleted' | 'unknown';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_ATTEMPTS = 3;
const CHECK_TIMEOUT_MS = 2000;

/**
 * anond は削除済み記事と存在しない記事のどちらにも 404 を返し、HEAD は 405 になるため GET で判定する
 */
export async function checkArticleStatus(url: string, fetcher: Fetcher = fetch): Promise<ArticleStatus> {
	try {
		const response = await fetcher(url, {
			headers: { 'User-Agent': 'masuda-forever-bot' },
			signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
		});
		await response.body?.cancel();
		if (response.status === 404) return 'deleted';
		return response.ok ? 'alive' : 'unknown';
	} catch {
		return 'unknown';
	}
}

export async function pickLiveArticleUrl({
	pickRandomUrl,
	checkStatus,
	markDeleted,
}: {
	pickRandomUrl: () => Promise<string | undefined>;
	checkStatus: (url: string) => Promise<ArticleStatus>;
	markDeleted: (url: string) => Promise<void>;
}): Promise<string | undefined> {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const url = await pickRandomUrl();
		if (!url) return undefined;
		if ((await checkStatus(url)) !== 'deleted') return url;
		await markDeleted(url);
	}

	return undefined;
}
