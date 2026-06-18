// generate-sitemap.js
// Builds sitemap.xml from species-slug-map.json plus core site pages
// Run with: node generate-sitemap.js

const fs = require('fs');
const path = require('path');

const SLUG_MAP_PATH = path.join(__dirname, 'species-slug-map.json');
const OUTPUT_PATH = path.join(__dirname, 'sitemap.xml');
const BASE_URL = 'https://zoetype.app';

function buildSitemap() {
  if (!fs.existsSync(SLUG_MAP_PATH)) {
    console.error('species-slug-map.json not found. Run generate-species-pages.js first.');
    return;
  }

  const slugMap = JSON.parse(fs.readFileSync(SLUG_MAP_PATH, 'utf-8'));
  const today = new Date().toISOString().split('T')[0];

  const coreUrls = [
    { loc: `${BASE_URL}/`, priority: '1.0' },
    { loc: `${BASE_URL}/quiz`, priority: '0.9' },
  ];

  const speciesUrls = slugMap.map((entry) => ({
    loc: `${BASE_URL}/species/${entry.slug}`,
    priority: '0.7',
  }));

  const allUrls = [...coreUrls, ...speciesUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  fs.writeFileSync(OUTPUT_PATH, xml);
  console.log(`Sitemap written with ${allUrls.length} URLs to sitemap.xml`);
}

buildSitemap();
