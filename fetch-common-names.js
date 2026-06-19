// fetch-common-names.js
// Asks Claude for the real, widely-recognized common name of each species
// and saves it to the common_name column in Supabase
// Run with: node fetch-common-names.js

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BATCH_LIMIT = 1200; // covers all remaining species

async function getCommonName(scientificName, classField, order, family) {
  const prompt = `What is the most widely recognized common name for the species "${scientificName}"?

Context: class ${classField || 'unknown'}, order ${order || 'unknown'}, family ${family || 'unknown'}.

Rules:
- Give ONLY the common name itself, nothing else. No explanation, no punctuation around it, no "the" prefix unless it's grammatically required as part of the name itself.
- If there is a single clear, widely used English common name, give that exact name with correct capitalization (e.g. "Grey Mouse Lemur", "Sea Otter", "Hooded Pitohui").
- If there is genuinely no common name in English and the species is only known by its scientific name (common for many obscure insects, deep sea organisms, and recently described species), respond with exactly: NONE
- Do not invent or guess a name. Only give a name if you are confident it is the real, recognized common name for this exact species.
- Respond with the name or NONE only. No other text.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 60,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  return text === 'NONE' ? null : text;
}

async function runBatch() {
  console.log(`Fetching up to ${BATCH_LIMIT} species missing common_name...`);

  const { data: speciesList, error } = await supabase
    .from('species')
    .select('id, scientific_name, class, order, family')
    .is('common_name', null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('Error fetching species:', error.message);
    return;
  }

  console.log(`Found ${speciesList.length} species to process.\n`);

  let foundCount = 0;
  let noneCount = 0;
  let failCount = 0;

  for (const animal of speciesList) {
    process.stdout.write(`${animal.scientific_name}...`);

    try {
      const commonName = await getCommonName(
        animal.scientific_name,
        animal.class,
        animal.order,
        animal.family
      );

      const { error: updateError } = await supabase
        .from('species')
        .update({ common_name: commonName })
        .eq('id', animal.id);

      if (updateError) {
        console.log(` FAILED to save`);
        failCount++;
      } else if (commonName) {
        console.log(` "${commonName}"`);
        foundCount++;
      } else {
        console.log(` no common name exists`);
        noneCount++;
      }
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
      failCount++;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`\nDone. Found names: ${foundCount}, No name exists: ${noneCount}, Failed: ${failCount}`);
}

runBatch();
