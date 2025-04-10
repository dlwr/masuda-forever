/**
 * masuda-forever
 *
 * anond.hatelabo.jpの記事URLを保全するスクレイパー
 */

import * as cheerio from 'cheerio';

interface ArticleURL {
	url: string;
	title: string;
}

interface ScrapeResult {
	newUrls: ArticleURL[];
	existingUrlsCount: number;
	pagesScraped: number;
}

interface HistoricalScrapeResult extends ScrapeResult {
	date: string;
}

interface BatchHistoricalScrapeResult {
	results: HistoricalScrapeResult[];
	totalNewUrls: number;
	totalExistingUrls: number;
	totalPagesScrapped: number;
	datesProcessed: string[];
	failedDates: Record<string, string>;
}

export default {
	async fetch(request: Request, environment: Env): Promise<Response> {
		const url = new URL(request.url);

		// 手動でスクレイピングを実行するエンドポイント
		if (url.pathname === '/scrape') {
			try {
				const result = await scrapeAnondUrls(environment);
				return new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// 過去記事スクレイピングのエンドポイント
		if (url.pathname === '/scrape-historical') {
			try {
				const dateParameter = url.searchParams.get('date');
				if (!dateParameter) {
					return new Response(JSON.stringify({ error: '日付パラメータが必要です（YYYYMMDD形式）' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				const dateRegex = /^\d{8}$/;
				if (!dateRegex.test(dateParameter)) {
					return new Response(JSON.stringify({ error: '日付はYYYYMMDD形式で指定してください' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				const result = await scrapeHistoricalAnondUrls(environment, dateParameter);
				return new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// 過去記事バッチスクレイピングのエンドポイント
		if (url.pathname === '/scrape-historical-batch') {
			try {
				const startDateParameter = url.searchParams.get('startDate');
				const endDateParameter = url.searchParams.get('endDate');

				if (!startDateParameter || !endDateParameter) {
					return new Response(
						JSON.stringify({
							error: '開始日(startDate)と終了日(endDate)のパラメータが必要です（YYYYMMDD形式）',
						}),
						{
							status: 400,
							headers: { 'Content-Type': 'application/json' },
						},
					);
				}

				const dateRegex = /^\d{8}$/;
				if (!dateRegex.test(startDateParameter) || !dateRegex.test(endDateParameter)) {
					return new Response(
						JSON.stringify({
							error: '日付はYYYYMMDD形式で指定してください',
						}),
						{
							status: 400,
							headers: { 'Content-Type': 'application/json' },
						},
					);
				}

				// 最大処理日数を制限（APIタイムアウト対策）
				const maxDays = Number.parseInt(url.searchParams.get('maxDays') || '7');

				const result = await batchScrapeHistoricalAnondUrls(environment, startDateParameter, endDateParameter, maxDays);
				return new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// スケジュールされたエンドポイントテスト用
		if (url.pathname === '/__scheduled') {
			try {
				const result = await scrapeAnondUrls(environment);
				return new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		return new Response('MasudaForever: anond.hatelabo.jp URL Archiver');
	},

	// スケジュールされたジョブ
	async scheduled(controller: ScheduledController, environment: Env): Promise<void> {
		console.log(`スクレイピング実行: ${controller.cron}`);

		try {
			// 通常のスクレイピング
			const result = await scrapeAnondUrls(environment);
			console.log(`スクレイピング完了: ${result.newUrls.length}件の新規URL追加、${result.pagesScraped}ページ処理`);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`スクレイピングエラー: ${errorMessage}`);
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * anond.hatelabo.jpからURLをスクレイピングする
 */
async function scrapeAnondUrls(environment: Env): Promise<ScrapeResult> {
	// 開始ページ
	const startUrl = 'https://anond.hatelabo.jp/';
	return await scrapeAnondUrlsRecursive(environment, startUrl);
}

/**
 * 特定日付のanond.hatelabo.jp/YYYYMMDD からURLをスクレイピングする
 */
async function scrapeHistoricalAnondUrls(environment: Env, date: string): Promise<HistoricalScrapeResult> {
	// 日付フォーマットに対応したURL
	const startUrl = `https://anond.hatelabo.jp/${date}`;
	const baseResult = await scrapeAnondUrlsRecursive(environment, startUrl);

	return {
		...baseResult,
		date,
	};
}

/**
 * 日付の範囲を指定して複数日の過去記事をバッチでスクレイピングする
 */
async function batchScrapeHistoricalAnondUrls(
	environment: Env,
	startDate: string,
	endDate: string,
	maxDays: number = 7,
): Promise<BatchHistoricalScrapeResult> {
	// 開始日と終了日のDateオブジェクトを作成
	const startDateObject = parseDateFromString(startDate);
	const endDateObject = parseDateFromString(endDate);

	if (!startDateObject || !endDateObject) {
		throw new Error('開始日または終了日のパースに失敗しました');
	}

	if (startDateObject > endDateObject) {
		throw new Error('開始日は終了日より前の日付を指定してください');
	}

	// 日付の配列を作成
	const dates: string[] = [];
	const currentDate = new Date(startDateObject);

	while (currentDate <= endDateObject && dates.length < maxDays) {
		dates.push(formatDateToString(currentDate));
		currentDate.setDate(currentDate.getDate() + 1);
	}

	console.log(`バッチスクレイピング: ${dates.length}日分の処理を開始します`);

	const results: HistoricalScrapeResult[] = [];
	const failedDates: Record<string, string> = {};

	// 各日付に対してスクレイピングを実行
	for (const date of dates) {
		try {
			console.log(`日付 ${date} のスクレイピングを開始`);
			const result = await scrapeHistoricalAnondUrls(environment, date);
			results.push(result);
			console.log(`日付 ${date} のスクレイピング完了: ${result.newUrls.length}件の新規URL`);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`日付 ${date} のスクレイピングエラー: ${errorMessage}`);
			failedDates[date] = errorMessage;
		}

		// APIリクエスト過多を避けるため、各リクエスト間に少し待機
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	// 結果を集計
	const batchResult: BatchHistoricalScrapeResult = {
		results,
		totalNewUrls: results.reduce((sum, result) => sum + result.newUrls.length, 0),
		totalExistingUrls: results.reduce((sum, result) => sum + result.existingUrlsCount, 0),
		totalPagesScrapped: results.reduce((sum, result) => sum + result.pagesScraped, 0),
		datesProcessed: results.map((result) => result.date),
		failedDates,
	};

	return batchResult;
}

/**
 * YYYYMMDD形式の文字列からDateオブジェクトを作成
 */
function parseDateFromString(dateString: string): Date | undefined {
	// YYYYMMDD形式をYYYY-MM-DDに変換
	if (!/^\d{8}$/.test(dateString)) {
		return undefined;
	}

	const year = Number.parseInt(dateString.slice(0, 4));
	const month = Number.parseInt(dateString.slice(4, 6)) - 1; // JavaScriptの月は0始まり
	const day = Number.parseInt(dateString.slice(6, 8));

	const date = new Date(year, month, day);

	// 日付が有効かチェック
	if (Number.isNaN(date.getTime())) {
		return;
	}

	return date;
}

/**
 * DateオブジェクトをYYYYMMDD形式の文字列に変換
 */
function formatDateToString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');

	return `${year}${month}${day}`;
}

/**
 * 再帰的にページをスクレイピングする
 */
async function scrapeAnondUrlsRecursive(environment: Env, pageUrl: string, maxPages: number = 10): Promise<ScrapeResult> {
	const result: ScrapeResult = {
		newUrls: [],
		existingUrlsCount: 0,
		pagesScraped: 0,
	};

	let currentUrl = pageUrl;
	let pagesProcessed = 0;
	let foundNewUrls = true;

	// 最大ページ数まで、または新しいURLが見つからなくなるまでスクレイピング
	while (currentUrl && pagesProcessed < maxPages && foundNewUrls) {
		console.log(`ページをスクレイピング: ${currentUrl}`);

		const response = await fetch(currentUrl);
		if (!response.ok) {
			throw new Error(`スクレイピング失敗: ${response.status} ${response.statusText}`);
		}

		const html = await response.text();
		const $ = cheerio.load(html);

		// 該当ページの記事URLを抽出
		const pageArticles: ArticleURL[] = [];
		$('div.section').each((_, element) => {
			const linkElement = $(element).find('h3 a');
			const url = linkElement.attr('href');
			const title = linkElement.text().trim() || '■';

			if (url) {
				const fullUrl = url.startsWith('http') ? url : `https://anond.hatelabo.jp${url}`;
				pageArticles.push({ url: fullUrl, title });
			}
		});

		console.log(`ページのスクレイピング結果: ${pageArticles.length}件のURL取得`);

		// 既存URLのカウンターと新規URLのフラグ
		let pageExistingUrls = 0;
		let pageNewUrls = 0;

		// 新しいURLのみをデータベースに保存
		for (const article of pageArticles) {
			try {
				// URLが既に存在するか確認
				const existingUrl = await environment.DB.prepare('SELECT url FROM article_urls WHERE url = ?')
					.bind(article.url)
					.first<{ url: string }>();

				if (existingUrl) {
					pageExistingUrls++;
				} else {
					// 新しいURLを保存
					await environment.DB.prepare('INSERT INTO article_urls (url, title) VALUES (?, ?)').bind(article.url, article.title).run();

					result.newUrls.push(article);
					pageNewUrls++;
					console.log(`新規URL保存: ${article.url}`);
				}
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`DB保存エラー: ${errorMessage}`);
			}
		}

		// このページで既存URLと衝突が多かった場合は処理を停止
		if (pageExistingUrls > 0 && pageNewUrls === 0) {
			console.log(`既存URLのみを検出したため停止します。`);
			foundNewUrls = false;
		}

		// 結果を更新
		result.existingUrlsCount += pageExistingUrls;
		result.pagesScraped++;
		pagesProcessed++;

		// 次のページURLを取得
		const nextPageLink = $('.pager-l a').attr('href');
		if (nextPageLink && foundNewUrls) {
			currentUrl = nextPageLink.startsWith('http') ? nextPageLink : `https://anond.hatelabo.jp${nextPageLink}`;
			console.log(`次のページに進みます: ${currentUrl}`);
		} else {
			currentUrl = '';
		}
	}

	return result;
}
