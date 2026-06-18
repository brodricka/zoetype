// generate-species-pages.js
// Reads species with completed result_portrait from Supabase, builds static HTML pages
// Always uses emoji fallback, no photo fetching
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

function getEmoji(cls, order) {
  const orderMap = {
    'Passeriformes': '🐦', 'Accipitriformes': '🦅', 'Strigiformes': '🦉',
    'Psittaciformes': '🦜', 'Sphenisciformes': '🐧', 'Anseriformes': '🦆',
    'Galliformes': '🐓', 'Columbiformes': '🕊️', 'Pelecaniformes': '🦢',
    'Phoenicopteriformes': '🦩', 'Gruiformes': '🦩',
    'Chiroptera': '🦇', 'Primates': '🐒', 'Rodentia': '🐭',
    'Carnivora': '🦁', 'Cetacea': '🐋', 'Cetartiodactyla': '🦌',
    'Perissodactyla': '🦓', 'Proboscidea': '🐘', 'Marsupialia': '🦘',
    'Lagomorpha': '🐇', 'Eulipotyphla': '🦔', 'Pilosa': '🦥', 'Cingulata': '🦔',
    'Squamata': '🦎', 'Testudines': '🐢', 'Crocodilia': '🐊',
    'Carcharhiniformes': '🦈', 'Lamniformes': '🦈', 'Perciformes': '🐠',
    'Tetraodontiformes': '🐡',
    'Lepidoptera': '🦋', 'Hymenoptera': '🐝', 'Coleoptera': '🪲',
    'Odonata': '🪲', 'Diptera': '🪰',
    'Octopoda': '🐙', 'Scorpiones': '🦂',
  };

  const classMap = {
    'Mammalia': '🐾', 'Aves': '🐦', 'Reptilia': '🦎', 'Amphibia': '🐸',
    'Actinopterygii': '🐟', 'Chondrichthyes': '🦈', 'Insecta': '🦋',
    'Arachnida': '🕷️', 'Malacostraca': '🦀', 'Cephalopoda': '🐙',
    'Asteroidea': '⭐', 'Scyphozoa': '🪼',
  };

  return orderMap[order] || classMap[cls] || '🐾';
}

async function buildPages() {
  console.log('Fetching species with completed portraits...');

  const { data: speciesList, error } = await supabase
    .from('species')
    .select('scientific_name, common_name, result_portrait, result_shadow, fun_fact, class, order')
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

    try {
      let portraitData;
      try {
        portraitData = JSON.parse(animal.result_portrait);
      } catch (e) {
        console.error(`Skipping ${displayName}: invalid portrait JSON`);
        failCount++;
        continue;
      }

      const paragraphs = portraitData.paragraphs || [];
      const portraitHtml = paragraphs
        .map((p) => `<p class="portrait-text">${p}</p>`)
        .join('\n  ');

      // Always use emoji — no photo fetching
      const emoji = getEmoji(animal.class, animal.order);
      const photoBlock = `<div class="hero-emoji">${emoji}</div>`;

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
      console.error(`Failed on ${displayName}:`, err.message);
      failCount++;
    }
  }

  fs.writeFileSync(
    path.join(__dirname, 'species-slug-map.json'),
    JSON.stringify(slugMap, null, 2)
  );

  console.log(`Done. Built: ${successCount}, Failed: ${failCount}`);
  console.log('Slug map saved to species-slug-map.json');
}

buildPages();
