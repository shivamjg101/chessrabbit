# ChessRabbit marketing website

A separate, frontend-only website for GitHub Pages. It does not run the desktop app, its API, or a chess engine. All public content is delivered as HTML, with CSS and a small optional JavaScript opening demo. No npm packages, account system, tracking, or server runtime are needed.

## Build and check

Use Node.js 22 or newer, from the repository root:

```sh
node website/build.mjs
node website/check.mjs
```

The generated website is in `website/dist` (ignored by Git). To preview, serve that directory with any static HTTP server; for example, if Python is installed:

```sh
python -m http.server 4173 --bind 127.0.0.1 --directory website/dist
```

Open `http://127.0.0.1:4173`. All content, navigation, FAQs and downloads work without JavaScript; the opening-position buttons are the only enhancement. The board is an illustrative study, not a screenshot or a live engine.

## Publish for free with GitHub Pages

1. Keep the website sources and workflow in the **public** `shivamjg101/chessrabbit` GitHub repository on `main`.
2. Open repository **Settings → Pages → Build and deployment → Source**, and select **GitHub Actions**.
3. Open **Actions → Deploy marketing website to GitHub Pages → Run workflow** on `main`. Later pushes that change `website/` or the workflow deploy automatically. Pull requests build and check without deploying.
4. The workflow uploads **only `website/dist`**, not your application, source tree, or local configuration. Its deployment result provides the live URL. The expected default is `https://shivamjg101.github.io/chessrabbit/`.

If the publishing branch is not `main`, update both the push branch and deploy condition in `.github/workflows/pages.yml`, and the Pages environment's allowed branch. GitHub Free supports Pages for public repositories. See [GitHub’s Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The workflow uses the URL returned by `configure-pages` for canonical links, social metadata and the sitemap, including a custom domain configured in Pages. To build locally for a different public URL, set `SITE_URL` before building:

```powershell
$env:SITE_URL = 'https://example.com/'
node website/build.mjs
node website/check.mjs
```

## Search visibility after launch

The site includes descriptive, unique titles and meta descriptions, canonical URLs, a sitemap, social previews, SoftwareApplication/Article structured data, accessible static HTML, and three linked guides targeting specific searches. No fabricated reviews, ratings, rankings, or keyword stuffing are included.

1. Add the live URL as a **URL-prefix property** in [Google Search Console](https://search.google.com/search-console). Complete ownership verification using Google's provided tag or file. For a verification tag, add it in the homepage `<head>`; for a verification file, add it to `website/` and the asset copy list in `build.mjs` so deployment preserves it. Do not add a made-up verification value.
2. Submit the full sitemap URL, normally `https://shivamjg101.github.io/chessrabbit/sitemap.xml`, and inspect the homepage URL to request indexing.
3. Add the live website URL to the GitHub repository's About section and README. Share useful guides with relevant chess communities when appropriate. Genuine references to the project help people discover it.
4. Keep download links, supported platforms, engine versions, and guides current. Use Search Console queries and indexing reports to decide what useful content to expand.
5. Evaluate specific queries such as “offline chess analysis Windows,” “free Stockfish analysis app,” and “PGN game review.” Broad “chess engine” queries cover a different intent from a desktop analysis app.

Google does not guarantee indexing or top placement. Technical SEO makes the site understandable and accessible; competitive rankings also depend on useful content, relevance, reputation, and time. See [Google’s SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

**Project-site robots caveat:** crawlers read `robots.txt` at the origin root. On the default project URL, `/chessrabbit/robots.txt` does not control `shivamjg101.github.io`. Submit the sitemap directly in Search Console. If you own the `shivamjg101.github.io` root site, its root `robots.txt` can also point to this sitemap. On a custom domain serving this site at `/`, the generated robots file is at the correct location.

## Editing

- `index.html`: homepage, product facts, main download links and SoftwareApplication metadata.
- `styles.css`: responsive styling, shared with the guides.
- `site.js`: opening-position controls.
- `guides.mjs`: guide text and search metadata.
- `build.mjs`: dependency-free static generation, shared guide layout, board illustrations, sitemap and URL handling.
- `assets/`: original rabbit favicon and 1200 × 630 PNG social preview.
- `check.mjs`: build checks, also run in GitHub Actions.

Update the versioned installer URL in both `index.html` and `build.mjs` when publishing a new release. Verify product claims against the desktop documentation. Images and styles are local, with system fonts and no third-party font requests.
