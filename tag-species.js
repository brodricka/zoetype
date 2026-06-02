import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// All keys verified directly from GBIF on May 31 2026
const GROUPS = [
  // Mammals
  { label: 'Carnivores',             key: 732,       expectedClass: 'Mammalia',          targetCount: 50 },
  { label: 'Primates',               key: 798,       expectedClass: 'Mammalia',          targetCount: 50 },
  { label: 'Whales & Dolphins',      key: 733,       expectedClass: 'Mammalia',          targetCount: 30 },
  { label: 'Bats',                   key: 734,       expectedClass: 'Mammalia',          targetCount: 50 },
  { label: 'Rodents',                key: 1459,      expectedClass: 'Mammalia',          targetCount: 50 },
  { label: 'Even-toed Ungulates',    key: 731,       expectedClass: 'Mammalia',          targetCount: 40 },
  { label: 'Odd-toed Ungulates',     key: 795,       expectedClass: 'Mammalia',          targetCount: 20 },
  { label: 'Rabbits & Hares',        key: 785,       expectedClass: 'Mammalia',          targetCount: 20 },
  { label: 'Marsupials',             key: 783,       expectedClass: 'Mammalia',          targetCount: 40 },
  { label: 'Monotremes',             key: 791,       expectedClass: 'Mammalia',          targetCount: 5  },
  // Birds
  { label: 'Songbirds',              key: 729,       expectedClass: 'Aves',              targetCount: 80 },
  { label: 'Hawks & Eagles',         key: 7191147,   expectedClass: 'Aves',              targetCount: 40 },
  { label: 'Owls',                   key: 1450,      expectedClass: 'Aves',              targetCount: 30 },
  { label: 'Parrots',                key: 1445,      expectedClass: 'Aves',              targetCount: 30 },
  { label: 'Penguins',               key: 7190978,   expectedClass: 'Aves',              targetCount: 18 },
  { label: 'Albatrosses & Petrels',  key: 7192755,   expectedClass: 'Aves',              targetCount: 30 },
  { label: 'Pigeons & Doves',        key: 1446,      expectedClass: 'Aves',              targetCount: 30 },
  // Reptiles
  { label: 'Lizards & Snakes',       key: 11592253,  expectedClass: 'Squamata',          targetCount: 60 },
  { label: 'Turtles & Tortoises',    key: 11418114,  expectedClass: 'Testudines',        targetCount: 30 },
  { label: 'Crocodilians',           key: 11493978,  expectedClass: 'Crocodylia',        targetCount: 23 },
  // Amphibians
  { label: 'Frogs & Toads',          key: 952,       expectedClass: 'Amphibia',          targetCount: 60 },
  { label: 'Salamanders',            key: 953,       expectedClass: 'Amphibia',          targetCount: 30 },
  // Fish - null class means no class filter, accept any class
  { label: 'Sharks',                 key: 887,       expectedClass: 'Elasmobranchii',    targetCount: 40 },
  { label: 'Salmon & Trout',         key: 1313,      expectedClass: null,                targetCount: 20 },
  { label: 'Perch-like Fish',        key: 587,       expectedClass: null,                targetCount: 40 },
  // Insects
  { label: 'Butterflies & Moths',    key: 797,       expectedClass: 'Insecta',           targetCount: 60 },
  { label: 'Ants, Bees & Wasps',     key: 1457,      expectedClass: 'Insecta',           targetCount: 40 },
  { label: 'Beetles',                key: 1470,      expectedClass: 'Insecta',           targetCount: 40 },
  { label: 'Dragonflies',            key: 789,       expectedClass: 'Insecta',           targetCount: 20 },
  // Arachnids
  { label: 'Spiders',                key: 1496,      expectedClass: 'Arachnida',         targetCount: 30 },
  { label: 'Scorpions',              key: 872,       expectedClass: 'Arachnida',         targetCount: 20 },
  // Marine invertebrates
  { label: 'Crabs & Lobsters',       key: 637,       expectedClass: 'Malacostraca',      targetCount: 30 },
  { label: 'Octopuses',              key: 459,       expectedClass: 'Cephalopoda',       targetCount: 20 },
  { label: 'Jellyfish',              key: 711,       expectedClass: 'Scyphozoa',         targetCount: 15 },
  { label: 'Sea Stars',              key: 1462,      expectedClass: 'Asteroidea',        targetCount: 15 },
];

async function fetchSpecies(groupKey, expectedClass, targetCount) {
  const species = [];
  let offset = 0;

  while (species.length < targetCount) {
    let url = `https://api.gbif.org/v1/species/search?highertaxonKey=${groupKey}&rank=SPECIES&status=ACCEPTED&isExtinct=false&limit=100&offset=${offset}`;
    if (expectedClass) {
      url += `&class=${expectedClass}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GBIF error ${res.status}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) break;

    for (const s of data.results) {
      if (s.canonicalName) {
        species.push(s);
        if (species.length >= targetCount) break;
      }
    }

    if (data.endOfRecords) break;
    offset += 100;
  }

  return species;
}

async function tagSpecies(sp) {
  const prompt = `You are tagging animal species for a personality quiz database.

Species: ${sp.canonicalName}
Common name: ${sp.vernacularName || 'unknown'}
Class: ${sp.class}
Order: ${sp.order || 'unknown'}
Family: ${sp.family || 'unknown'}

Return ONLY a valid JSON object. No explanation, no markdown, no code blocks. Just raw JSON:
{
  "cognitive_style": <number -1.0 to 1.0>,
  "emotional_regulation": <number -1.0 to 1.0>,
  "attachment_style": <number -1.0 to 1.0>,
  "social_architecture": <number -1.0 to 1.0>,
  "ecological_role": <"apex_predator"|"predator"|"omnivore"|"herbivore"|"scavenger"|"decomposer"|"filter_feeder"|"parasite"|"keystone">,
  "aspiration_drive": <number -1.0 to 1.0>,
  "creativity_play": <number -1.0 to 1.0>,
  "physicality": <number -1.0 to 1.0>,
  "camouflage_display": <number -1.0 to 1.0>,
  "social_legibility": <number -1.0 to 1.0>,
  "transformation": <number -1.0 to 1.0>,
  "curiosity": <number -1.0 to 1.0>,
  "shadow": "<one sentence about this animal's dark or difficult survival trait>",
  "fun_fact": "<one genuinely surprising fact about this species>"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function saveToSupabase(sp, tags) {
  const row = {
    gbif_id: String(sp.key),
    scientific_name: sp.canonicalName,
    common_name: sp.vernacularName || null,
    class: sp.class || null,
    order: sp.order || null,
    family: sp.family || null,
    kingdom: sp.kingdom || null,
    phylum: sp.phylum || null,
    ...tags,
  };

  const { error } = await supabase.from('species').upsert(row, { onConflict: 'gbif_id' });
  if (error) throw new Error(error.message);
}

async function main() {
  console.log('============================================================');
  console.log('WHAT ANIMAL ARE YOU? -- SPECIES TAGGING PIPELINE v8');
  console.log('============================================================');
  console.log(`Processing ${GROUPS.length} taxonomic groups\n`);

  let totalProcessed = 0;
  let totalSucceeded = 0;

  for (const group of GROUPS) {
    console.log(`\n--- ${group.label} ---`);

    let speciesList;
    try {
      speciesList = await fetchSpecies(group.key, group.expectedClass, group.targetCount);
    } catch (err) {
      console.log(`  GBIF fetch error: ${err.message}`);
      continue;
    }

    console.log(`  Fetched ${speciesList.length} species`);
    if (speciesList.length > 0) {
      console.log(`  Preview: ${speciesList.slice(0, 3).map(s => s.canonicalName).join(', ')}`);
    }
    if (speciesList.length === 0) {
      console.log(`  Skipping — no species returned`);
      continue;
    }

    let groupSucceeded = 0;

    for (const sp of speciesList) {
      totalProcessed++;
      await new Promise(r => setTimeout(r, 2000));

      try {
        const tags = await tagSpecies(sp);
        await saveToSupabase(sp, tags);
        groupSucceeded++;
        totalSucceeded++;
        const name = sp.vernacularName
          ? `${sp.canonicalName} (${sp.vernacularName})`
          : sp.canonicalName;
        console.log(`  ✓ ${name}`);
      } catch (err) {
        const msg = err.message || String(err);
        console.log(`  ✗ ${sp.canonicalName}: ${msg.slice(0, 120)}`);
        if (msg.includes('rate_limit')) {
          console.log(`  [rate limit — waiting 15s]`);
          await new Promise(r => setTimeout(r, 15000));
        }
      }
    }

    console.log(`  Group complete: ${groupSucceeded}/${speciesList.length} saved`);
    console.log(`  Running total: ${totalSucceeded}/${totalProcessed}`);
  }

  console.log('\n============================================================');
  console.log('PIPELINE COMPLETE');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total succeeded: ${totalSucceeded}`);
  console.log('============================================================');
}

main().catch(console.error);