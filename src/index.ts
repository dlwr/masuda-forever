/**
 * masuda-forever
 *
 * anond.hatelabo.jpの記事URLを保全するスクレイパー
 */

import { createClient } from '@libsql/client';
import { checkArticleStatus, pickLiveArticleUrl } from './shared/article-picker.js';
import { buildCandidates, type CandidateDay, candidateDay, forgetCandidate, loadCandidates } from './shared/candidate-store.js';
import { pickCandidatePath } from './shared/candidates.js';
import { isArticlePath, isMirroredPath, mirror } from './shared/mirror.js';
import { scrapeSinglePageLight } from './shared/scraper.js';

type TursoEnvironment = {
	TURSO_DB_URL: string;
	TURSO_AUTH_TOKEN: string;
};

type Environment = TursoEnvironment & {
	CANDIDATES: KVNamespace;
	RATE_LIMITER: RateLimit;
};

type TursoClient = ReturnType<typeof createClient>;

/**
 * スクレイピング進捗情報
 */
interface ScrapeProgress {
	date: string;
	status: 'pending' | 'in_progress' | 'completed';
	lastPageUrl: string | undefined;
	pagesScraped: number;
	urlsFound: number;
}

function createTursoClient(environment: TursoEnvironment): TursoClient {
	if (!environment.TURSO_DB_URL) {
		throw new Error('TURSO_DB_URL is not set');
	}

	if (!environment.TURSO_AUTH_TOKEN) {
		throw new Error('TURSO_AUTH_TOKEN is not set');
	}

	return createClient({
		url: environment.TURSO_DB_URL,
		authToken: environment.TURSO_AUTH_TOKEN,
		fetch,
	});
}

const NEXT_BATCH_SIZE = 20;

const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

export default {
	async fetch(request: Request, environment: Environment, context: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/robots.txt') return new Response(ROBOTS_TXT);

		const { success } = await environment.RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? '' });
		if (!success) return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } });

		if (request.method === 'GET' && isMirroredPath(url.pathname)) {
			const response = await mirror(url.pathname, url.search);
			if (response.status !== 404 || !isArticlePath(url.pathname) || url.search !== '') return response;

			const day = candidateDay(convertToJST(new Date()));
			forgetCandidate(day, url.pathname);
			context.waitUntil(markDeleted(environment, `https://anond.hatelabo.jp${url.pathname}`));
			try {
				const liveUrl = await pickLiveUrl(environment, day);
				if (!liveUrl) return response;
				await response.body?.cancel();
				return Response.redirect(new URL(new URL(liveUrl).pathname, url).href, 302);
			} catch (error: unknown) {
				console.error('削除済み記事の代わりを選べませんでした:', error);
				return response;
			}
		}

		if (url.pathname !== '/' && url.pathname !== '/random' && url.pathname !== '/api/next') {
			return new Response('MasudaForever: anond.hatelabo.jp URL Archiver');
		}

		try {
			const day = candidateDay(convertToJST(new Date()));
			const candidates = await loadCandidates(environment.CANDIDATES, day, (years, monthDay) =>
				queryCandidateUrls(environment, years, monthDay),
			);

			if (url.pathname === '/api/next') {
				const paths = Array.from({ length: NEXT_BATCH_SIZE }, () => pickCandidatePath(candidates, day.monthDay)).filter(
					(path) => path !== undefined,
				);
				return Response.json(paths, { headers: { 'Cache-Control': 'no-store' } });
			}

			if (url.pathname === '/random') {
				const path = pickCandidatePath(candidates, day.monthDay);
				return path
					? Response.redirect(new URL(path, url).href, 302)
					: new Response('No matching historical article found for this date.', { status: 404 });
			}

			const liveUrl = await pickLiveUrl(environment, day);
			return liveUrl
				? Response.redirect(liveUrl, 302)
				: new Response('No matching historical article found for this date.', { status: 404 });
		} catch (error: unknown) {
			console.error('Error handling root path redirect:', error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			return new Response(JSON.stringify({ error: `Failed to process redirect: ${errorMessage}` }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	},

	// スケジュールされたジョブ
	async scheduled(controller: ScheduledController, environment: Environment): Promise<void> {
		console.log(`スクレイピング実行: ${controller.cron}`);

		let client: TursoClient | undefined;
		try {
			client = createTursoClient(environment);

			// 1. 最新記事のスクレイピング（軽量版: 1ページのみ）
			try {
				const latestResult = await scrapeSinglePageLight(client, 'https://anond.hatelabo.jp/');
				console.log(`最新記事スクレイピング完了: ${latestResult.insertedCount}件追加`);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`最新記事スクレイピングエラー: ${errorMessage}`);
			}

			// 2. 今日と明日の候補一覧を KV に用意する
			try {
				await prepareCandidates(environment);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`候補一覧の準備エラー: ${errorMessage}`);
			}

			// 3. 過去日付の埋め合わせ（1ページのみ）
			try {
				await scrapeNextPendingDate(client);
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`過去日付スクレイピングエラー: ${errorMessage}`);
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`スクレイピングエラー: ${errorMessage}`);
		} finally {
			client?.close();
		}
	},
} satisfies ExportedHandler<Environment>;

async function queryCandidateUrls(environment: TursoEnvironment, years: string[], monthDay: string): Promise<string[]> {
	if (years.length === 0) return [];

	const client = createTursoClient(environment);
	try {
		const result = await client.execute({
			sql: `SELECT url FROM article_urls
			 WHERE url_year IN (${years.map(() => '?').join(', ')}) AND url_monthday = ? AND deleted_at IS NULL`,
			args: [...years, monthDay],
		});
		return result.rows.map((row) => String(row.url));
	} finally {
		client.close();
	}
}

async function pickLiveUrl(environment: Environment, day: CandidateDay): Promise<string | undefined> {
	return pickLiveArticleUrl({
		pickRandomUrl: async () => {
			const candidates = await loadCandidates(environment.CANDIDATES, day, (years, monthDay) =>
				queryCandidateUrls(environment, years, monthDay),
			);
			const path = pickCandidatePath(candidates, day.monthDay);
			return path && `https://anond.hatelabo.jp${path}`;
		},
		checkStatus: (articleUrl) => checkArticleStatus(articleUrl),
		async markDeleted(articleUrl) {
			forgetCandidate(day, new URL(articleUrl).pathname);
			await markDeleted(environment, articleUrl);
		},
	});
}

async function markDeleted(environment: TursoEnvironment, url: string): Promise<void> {
	const client = createTursoClient(environment);
	try {
		await client.execute({
			sql: 'UPDATE article_urls SET deleted_at = CURRENT_TIMESTAMP WHERE url = ?1 AND deleted_at IS NULL',
			args: [url],
		});
	} finally {
		client.close();
	}
}

async function prepareCandidates(environment: Environment): Promise<void> {
	const now = convertToJST(new Date());
	if (now.getUTCMinutes() % 10 !== 0) return;

	for (const date of [now, new Date(now.getTime() + 24 * 60 * 60 * 1000)]) {
		const day = candidateDay(date);
		const stored = await environment.CANDIDATES.get(day.key, 'stream');
		if (stored) {
			await stored.cancel();
			continue;
		}

		await buildCandidates(environment.CANDIDATES, day, (years, monthDay) => queryCandidateUrls(environment, years, monthDay));
		console.log(`候補一覧を作成: ${day.key}`);
	}
}

/**
 * 次に処理すべき日付を取得して1ページスクレイピング
 */
async function scrapeNextPendingDate(client: TursoClient): Promise<void> {
	const progress = await getNextPendingProgress(client);
	if (!progress) {
		console.log('処理待ちの日付がありません');
		return;
	}

	console.log(`過去日付スクレイピング開始: ${progress.date} (status: ${progress.status})`);

	// スクレイピングするURL
	const pageUrl = progress.lastPageUrl ?? `https://anond.hatelabo.jp/${progress.date}`;

	try {
		const result = await scrapeSinglePageLight(client, pageUrl);

		// 進捗を更新
		if (result.nextPageUrl) {
			// 次ページがある場合: in_progress状態で継続
			await updateProgress(
				client,
				progress.date,
				'in_progress',
				result.nextPageUrl,
				progress.pagesScraped + 1,
				progress.urlsFound + result.insertedCount,
			);
			console.log(`${progress.date}: ページ${progress.pagesScraped + 1}完了、次ページあり`);
		} else {
			// 次ページがない場合: completed
			await updateProgress(
				client,
				progress.date,
				'completed',
				undefined,
				progress.pagesScraped + 1,
				progress.urlsFound + result.insertedCount,
			);
			console.log(
				`${progress.date}: スクレイピング完了 (${progress.pagesScraped + 1}ページ、${progress.urlsFound + result.insertedCount}件)`,
			);
		}
	} catch (error) {
		console.error(`${progress.date}: スクレイピングエラー`, error);
		// エラーでもin_progressのまま（次回リトライ）
	}
}

/**
 * 次に処理すべき進捗情報を取得（今日に近い月日を優先）
 */
async function getNextPendingProgress(client: TursoClient): Promise<ScrapeProgress | undefined> {
	const now = convertToJST(new Date());
	const todayDayOfYear = getDayOfYear(now.getMonth() + 1, now.getDate());

	// in_progressの日付を優先、なければpendingの日付を取得
	// 優先度: 今日からの未来方向の距離が近い順
	const result = await client.execute({
		sql: `
			SELECT
				date,
				status,
				last_page_url as lastPageUrl,
				pages_scraped as pagesScraped,
				urls_found as urlsFound
			FROM scrape_progress
			WHERE status IN ('pending', 'in_progress')
			ORDER BY
				CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
				(CAST(substr(date, 5, 2) AS INTEGER) - 1) * 31 + CAST(substr(date, 7, 2) AS INTEGER) - ?1 +
				CASE WHEN (CAST(substr(date, 5, 2) AS INTEGER) - 1) * 31 + CAST(substr(date, 7, 2) AS INTEGER) < ?1
					THEN 365 ELSE 0 END
			LIMIT 1
		`,
		args: [todayDayOfYear],
	});

	const row = result.rows[0] as unknown as
		| {
				date: string;
				status: string;
				lastPageUrl: string | undefined;
				pagesScraped: number;
				urlsFound: number;
		  }
		| undefined;

	if (!row) return undefined;

	return {
		date: row.date,
		status: row.status as 'pending' | 'in_progress' | 'completed',
		lastPageUrl: row.lastPageUrl ?? undefined,
		pagesScraped: row.pagesScraped,
		urlsFound: row.urlsFound,
	};
}

/**
 * 進捗を更新
 */
async function updateProgress(
	client: TursoClient,
	date: string,
	status: 'pending' | 'in_progress' | 'completed',
	lastPageUrl: string | undefined,
	pagesScraped: number,
	urlsFound: number,
): Promise<void> {
	await client.execute({
		sql: `
			UPDATE scrape_progress
			SET status = ?, last_page_url = ?, pages_scraped = ?, urls_found = ?, updated_at = CURRENT_TIMESTAMP
			WHERE date = ?
		`,
		// Tursoはundefinedをサポートしないのでnullに変換
		// eslint-disable-next-line unicorn/no-null
		args: [status, lastPageUrl ?? null, pagesScraped, urlsFound, date],
	});
}

/**
 * 月日から年間の通算日を計算（簡易版）
 */
function getDayOfYear(month: number, day: number): number {
	const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	let dayOfYear = day;
	for (let index = 0; index < month - 1; index++) {
		dayOfYear += daysInMonth[index];
	}
	return dayOfYear;
}

/**
 * UTCの日付をJST（日本標準時）に変換する
 */
function convertToJST(date: Date): Date {
	return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}
