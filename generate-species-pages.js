// generate-species-pages.js
// Reads species with completed result_portrait from Supabase, builds static HTML pages
// Run with: node generate-species-pages.js

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const OUTPUT_DIR = path.join(__dirname, 'species');
const TEMPLATE_PATH = path.join(__dirname, 'species-template.html');

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function buildPages() {
  console.log('Fetching species with completed portraits...');

  const { data: speciesList, error } = await supabase
    .from('species')
    .select('scientific_name, common_name, result_portrait, result_shadow, fun_fact, image_url')
    .not('result_portrait', 'is', null);

  if (error) {
    console.error('Error fetching species:', error.message);
    return;
  }

  console.log(`Found ${speciesList.length} species to build pages for.\n`);

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
  }

  let successCount = 0;
  let failCount = 0;
  const slugMap = [];

  for (const animal of speciesList) {
    const displayName = animal.common_name || animal.scientific_name;
    const slug = slugify(animal.common_name || animal.scientific_name);

    console.log(`Building: ${displayName} (/species/${slug})...`);

    try {
      let portraitData;
      try {
        portraitData = JSON.parse(animal.result_portrait);
      } catch (e) {
        console.error(`  Skipping ${displayName}: invalid portrait JSON`);
        failCount++;
        continue;
      }

      const paragraphs = portraitData.paragraphs || [];
      const portraitHtml = paragraphs
        .map((p) => `<p class="portrait-text">${p}</p>`)
        .join('\n  ');

      // Use stored image_url from Supabase instead of live API call
      const photoUrl = animal.image_url || null;
      const photoBlock = photoUrl
        ? `<img src="${photoUrl}" alt="${displayName}" class="hero-photo">`
        : '';

      let page = template
        .replaceAll('{{COMMON_NAME}}', displayName)
        .replaceAll('{{SCIENTIFIC_NAME}}', animal.scientific_name)
        .replaceAll('{{PORTRAIT_PARAGRAPHS}}', portraitHtml)
        .replaceAll('{{SHADOW_TEXT}}', animal.result_shadow || '')
        .replaceAll('{{FUN_FACT_TEXT}}', animal.fun_fact || '')
        .replaceAll('{{PHOTO_BLOCK}}', photoBlock);

      fs.writeFileSync(path.join(OUTPUT_DIR, `${slug}.html`), page);
      slugMap.push({ slug, name: displayName });
      successCount++;
    } catch (err) {
      console.error(`  Failed on ${displayName}:`, err.message);
      failCount++;
    }
  }

  fs.writeFileSync(
    path.join(__dirname, 'species-slug-map.json'),
    JSON.stringify(slugMap, null, 2)
  );

  console.log(`\nDone. Built: ${successCount}, Failed: ${failCount}`);
  console.log('Slug map saved to species-slug-map.json');
}

buildPages();
