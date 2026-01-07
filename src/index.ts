/**
 * masuda-forever
 *
 * anond.hatelabo.jpの記事URLを保全するスクレイパー
 */

import { createClient } from '@libsql/client';
import { scrapeSinglePageLight } from './shared/scraper.js';

type TursoEnvironment = {
	TURSO_DB_URL: string;
	TURSO_AUTH_TOKEN: string;
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

export default {
	async fetch(request: Request, environment: TursoEnvironment): Promise<Response> {
		const url = new URL(request.url);
		// ルートURL: 日付に基づいてランダムな過去記事へリダイレクト
		if (url.pathname === '/') {
			let client: TursoClient | undefined;
			try {
				client = createTursoClient(environment);
				const now = convertToJST(new Date());
				const month = String(now.getMonth() + 1).padStart(2, '0'); // 01-12
				const day = String(now.getDate()).padStart(2, '0'); // 01-31
				const currentYear = now.getFullYear(); // YYYY (as number)
				const currentMonthDay = `${month}${day}`; // Month and Day (e.g., 0410)

				// Determine the start year based on the current date
				const monthNumber = now.getMonth() + 1; // 1-12
				const dayNumber = now.getDate(); // 1-31

				const startYear = monthNumber > 9 || (monthNumber === 9 && dayNumber >= 24) ? 2006 : 2007;

				// Determine the end year (last year)
				const endYear = currentYear - 1;

				// Check if there are any valid past years to select from
				if (startYear > endYear) {
					return new Response('No valid past years found for this date.', { status: 404 });
				}

				// Select a random year between startYear and endYear (inclusive)
				const numberOfYears = endYear - startYear + 1;
				const randomYear = Math.floor(Math.random() * numberOfYears) + startYear;
				const randomYearString = String(randomYear);

				// Fetch a random article from that specific year and month/day
				const result = await client.execute({
					sql: `SELECT url FROM article_urls
					 WHERE substr(url, 27, 4) = ?1 -- Check Year from URL path (position 27)
					   AND substr(url, 31, 4) = ?2 -- Check MonthDay from URL path (position 31)
					 ORDER BY RANDOM()
					 LIMIT 1`,
					args: [randomYearString, currentMonthDay],
				});

				const row = result.rows[0] as { url?: string } | undefined;

				return row?.url
					? Response.redirect(row.url, 302)
					: new Response('No matching historical article found for this date.', { status: 404 });
			} catch (error: unknown) {
				console.error('Error handling root path redirect:', error);
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: `Failed to process redirect: ${errorMessage}` }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			} finally {
				client?.close();
			}
		}

		return new Response('MasudaForever: anond.hatelabo.jp URL Archiver');
	},

	// スケジュールされたジョブ
	async scheduled(controller: ScheduledController, environment: TursoEnvironment): Promise<void> {
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

			// 2. 過去日付の埋め合わせ（1ページのみ）
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
} satisfies ExportedHandler<TursoEnvironment>;

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
			console.log(`${progress.date}: スクレイピング完了 (${progress.pagesScraped + 1}ページ、${progress.urlsFound + result.insertedCount}件)`);
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
