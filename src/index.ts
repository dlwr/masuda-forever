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

export default {
	async fetch(request: Request, environment: Env): Promise<Response> {
		const url = new URL(request.url);
		// ルートURL: 日付に基づいてランダムな過去記事へリダイレクト
		if (url.pathname === '/') {
			try {
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
				const stmt = environment.DB.prepare(
					`SELECT url FROM article_urls
					 WHERE substr(url, 27, 4) = ?1 -- Check Year from URL path (position 27)
					   AND substr(url, 31, 4) = ?2 -- Check MonthDay from URL path (position 31)
					 ORDER BY RANDOM()
					 LIMIT 1`,
				).bind(randomYearString, currentMonthDay);

				const result = await stmt.first<{ url: string }>();

				return result && result.url
					? Response.redirect(result.url, 302)
					: new Response('No matching historical article found for this date.', { status: 404 });
			} catch (error: unknown) {
				console.error('Error handling root path redirect:', error);
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: `Failed to process redirect: ${errorMessage}` }), {
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
 * 再帰的にページをスクレイピングする
 */
async function scrapeAnondUrlsRecursive(
	environment: Env,
	pageUrl: string,
	maxPages: number | undefined = undefined,
): Promise<ScrapeResult> {
	const result: ScrapeResult = {
		newUrls: [],
		existingUrlsCount: 0,
		pagesScraped: 0,
	};

	let currentUrl = pageUrl;
	let pagesProcessed = 0;
	const foundNewUrls = true;

	// 最大ページ数まで、または新しいURLが見つからなくなるまでスクレイピング
	while (currentUrl && (!maxPages || pagesProcessed < maxPages) && foundNewUrls) {
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
					console.log(`新規URL保存: ${article.url}`);
				}
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`DB保存エラー: ${errorMessage}`);
			}
		}

		// 結果を更新
		result.existingUrlsCount += pageExistingUrls;
		result.pagesScraped++;
		pagesProcessed++;

		// 次のページURLを取得
		const nextPageLink = $('.pager-l a')
			.filter((_, element) => $(element).text().includes('次'))
			.attr('href');
		if (nextPageLink && foundNewUrls) {
			currentUrl = nextPageLink.startsWith('http') ? nextPageLink : `https://anond.hatelabo.jp${nextPageLink}`;
			console.log(`次のページに進みます: ${currentUrl}`);
		} else {
			currentUrl = '';
		}
	}

	return result;
}

/**
 * UTCの日付をJST（日本標準時）に変換する
 */
function convertToJST(date: Date): Date {
	return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}
