// generate-canonical-production.js
// Generates canonical portraits for species missing result_portrait, writes to Supabase
// Run with: node generate-canonical-production.js

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BATCH_LIMIT = 100; // change this number to run more or fewer per run

async function generateCanonicalPortrait(animal) {
  const prompt = `You are writing the canonical Zoëtype species page for the ${animal.common_name || animal.scientific_name} (${animal.scientific_name}).

ANIMAL DATA:
- Ecological role: ${animal.ecological_role || 'unknown, infer from class and order'}
- Shadow behavior: ${animal.shadow || 'unknown, infer plausible shadow from class and order'}
- Species fact: ${animal.fun_fact || 'unknown, infer a plausible specific fact from class and order'}

CONTEXT: This is a public page describing what it means to match with this animal on Zoëtype, not a personalized result from someone's actual quiz answers. Write to a hypothetical "you" who matched with this animal, grounded in the animal's own defining natural traits rather than any individual's specific dimension scores.

YOUR JOB:
Write a result that makes the reader feel genuinely seen, as if they actually matched with this animal. The portrait should feel complete. Do not comment on what the portrait leaves out. Do not write sentences about what this page cannot cover. Do not narrate the portrait's own limitations. Just write the portrait. If you do your job well, the reader will naturally want more without being told they should want more.

ABSOLUTE WRITING RULES:
- Write entirely in second person. "You" throughout. No names appear in this portrait.
- No em dashes anywhere. Use periods or commas instead.
- No "not X, it's Y" or "not because X, but because Y" or any contrastive negation structure, in any punctuation form. State the thing directly instead. Cut the negation entirely and just say what is true.
- No "you likely," "you may," "something of this," "a kind of," "in a way," "perhaps," "it seems."
- No dimension score names. Never write "your cognitive score" or "your attachment score."
- No vague profundity. Every sentence must land something specific.
- Every psychological observation must connect to a real biological fact about this animal.
- Write like a sharp journalist who knows this animal deeply and sees this person clearly.
- Short sentences hit harder than long ones.
- Do not summarize. Do not explain. State things.
- Avoid overused phrasing across a large batch of species. Specifically avoid: "load-bearing," "accumulates," "the gaps don't announce themselves," "is not decorative," and similar stock metaphors. Find language specific to this exact animal instead.

PORTRAIT — three paragraphs:

Paragraph 1: Open with one specific biological fact about this animal that immediately reframes how the reader sees themselves. First sentence carries the weight. Do not build to it. Three to four sentences. End cleanly.

Paragraph 2: How this animal processes its world. How it hunts, bonds, navigates, or survives. Connect each observation directly to how this person functions. Be specific about the animal. Be specific about the person. Four to five sentences. End on a precise observation about this person, something true and specific, not vague.

Paragraph 3: The ecological role of this animal. What the ecosystem loses without it. Connect this to what the people and systems around this person lose when they are absent or disengaged. Three to four sentences. End with a single clean factual statement about this person.

SHADOW — one paragraph:
The dark side of this animal's defining trait. What it does that is uncomfortable or costs something. Connect it directly to this person without softening it. Name the shadow clearly. End on a specific statement about what this costs them, not a vague gesture. Three to four sentences.

SPECIES FACT — one paragraph:
One true, specific, striking fact about this animal that lands as a revelation about the person reading it. The fact should recontextualize something about how they live or how they are built. End with a sentence that makes the personal connection explicit and lands with weight. Three sentences maximum. No hedging.

Respond ONLY in this exact JSON format with no markdown, no backticks, no preamble:
{
  "paragraphs": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "shadow": "shadow paragraph",
  "fun_fact": "species fact paragraph"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function runProductionBatch() {
  console.log(`Fetching up to ${BATCH_LIMIT} species missing result_portrait...`);

  const { data: speciesList, error } = await supabase
    .from('species')
    .select('id, scientific_name, common_name, ecological_role, shadow, fun_fact')
    .is('result_portrait', null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('Error fetching species:', error.message);
    return;
  }

  console.log(`Found ${speciesList.length} species to process.\n`);

  let successCount = 0;
  let failCount = 0;

  for (const animal of speciesList) {
    const label = animal.common_name || animal.scientific_name;
    console.log(`Generating: ${label} (${animal.scientific_name})...`);

    try {
      const portrait = await generateCanonicalPortrait(animal);

      const { error: updateError } = await supabase
        .from('species')
        .update({
          result_portrait: JSON.stringify({ paragraphs: portrait.paragraphs }),
          result_shadow: portrait.shadow,
          fun_fact: animal.fun_fact || portrait.fun_fact, // keep existing fun_fact if present
        })
        .eq('id', animal.id);

      if (updateError) {
        console.error(`  Failed to save ${label}:`, updateError.message);
        failCount++;
      } else {
        console.log(`  Saved: ${label}`);
        successCount++;
      }
    } catch (err) {
      console.error(`  Failed to generate ${label}:`, err.message);
      failCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\nBatch complete. Success: ${successCount}, Failed: ${failCount}`);
}

runProductionBatch();
