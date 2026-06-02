import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function tagNurturing(sp) {
  const prompt = `You are scoring an animal species on a single personality dimension for a quiz database.

Species: ${sp.scientific_name}
Common name: ${sp.common_name || 'unknown'}
Class: ${sp.class}
Order: ${sp.order || 'unknown'}
Family: ${sp.family || 'unknown'}

Score this species on the NURTURING dimension only.

Nurturing measures parental investment, caregiving instinct, and protective behavior toward vulnerable others.

-1.0 = Zero parental investment. Reproduces and immediately abandons. Offspring survive entirely alone from birth or hatching. No protective behavior whatsoever.
0.0 = Moderate. Some brief parental protection or provisioning but limited investment overall.
+1.0 = Extreme parental investment. Multi-year intensive caregiving, self-sacrifice for offspring, or alloparenting of others' young. Complete devotion to nurturing.

Return ONLY a valid JSON object with one field. No explanation, no markdown:
{"nurturing": <number -1.0 to 1.0>}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 50,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function main() {
  console.log('============================================================');
  console.log('NURTURING DIMENSION TAGGING -- targeted single-dimension run');
  console.log('============================================================\n');

  const { data: species, error } = await supabase
    .from('species')
    .select('id, scientific_name, common_name, class, order, family')
    .is('nurturing', null)
    .order('id');

  if (error) {
    console.error('Supabase error:', error.message);
    return;
  }

  console.log(`Found ${species.length} species to tag\n`);

  let succeeded = 0;
  let failed = 0;

  for (const sp of species) {
    await new Promise(r => setTimeout(r, 1500));

    try {
      const tags = await tagNurturing(sp);
      const { error: updateError } = await supabase
        .from('species')
        .update({ nurturing: tags.nurturing })
        .eq('id', sp.id);

      if (updateError) throw new Error(updateError.message);

      succeeded++;
      console.log(`✓ ${sp.scientific_name}: ${tags.nurturing}`);
    } catch (err) {
      failed++;
      const msg = err.message || String(err);
      console.log(`✗ ${sp.scientific_name}: ${msg.slice(0, 100)}`);
      if (msg.includes('rate_limit')) {
        console.log('[rate limit — waiting 15s]');
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  }

  console.log('\n============================================================');
  console.log(`COMPLETE: ${succeeded} succeeded, ${failed} failed`);
  console.log('============================================================');
}

main().catch(console.error);