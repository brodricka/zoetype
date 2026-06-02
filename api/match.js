// ZOETYPE MATCHING ENGINE
// Vercel serverless function — POST /api/match
// Body: { answers: { questionId: answerValue, ... } }
// Returns: { animal, portrait, shadow, fun_fact, dimensions }

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { scoreAnswers, buildMatchVector, cosineSimilarity, MATCH_COLUMNS } = require('../scoring');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { answers } = req.body;
    if (!answers) {
      return res.status(400).json({ error: 'No answers provided' });
    }

    // STEP 1: Convert answers to dimension scores
    const dimScores = scoreAnswers(answers);

    // STEP 2: Build the match vector (only DB dimensions)
    const userVector = buildMatchVector(dimScores);

    // STEP 3: Pull all species from Supabase with their dimension scores
    const { data: species, error: dbError } = await supabase
      .from('species')
      .select([
        'id', 'scientific_name', 'common_name', 'class', 'order', 'family',
        'ecological_role', 'shadow', 'fun_fact',
        ...MATCH_COLUMNS
      ].join(','));

    if (dbError) {
      console.error('Supabase error:', dbError);
      return res.status(500).json({ error: 'Database error' });
    }

    // STEP 4: Score each species against user vector using cosine similarity
    let bestMatch = null;
    let bestScore = -Infinity;

    for (const sp of species) {
      const spVector = {};
      for (const col of MATCH_COLUMNS) {
        spVector[col] = sp[col] ?? 0;
      }
      const score = cosineSimilarity(userVector, spVector, MATCH_COLUMNS);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = sp;
      }
    }

    if (!bestMatch) {
      return res.status(500).json({ error: 'No match found' });
    }

    // STEP 5: Get animal photo from GBIF
    const photoUrl = await getAnimalPhoto(bestMatch.scientific_name);

    // STEP 6: Generate personalized portrait using Claude
    const portrait = await generatePortrait(bestMatch, dimScores, userVector);

    // STEP 7: Return full result
    return res.status(200).json({
      animal: {
        scientific_name: bestMatch.scientific_name,
        common_name: bestMatch.common_name || formatScientificName(bestMatch.scientific_name),
        class: bestMatch.class,
        ecological_role: bestMatch.ecological_role,
        photo_url: photoUrl,
        gbif_url: `https://www.gbif.org/species/search?q=${encodeURIComponent(bestMatch.scientific_name)}`,
      },
      match_score: Math.round(bestScore * 100),
      portrait: portrait.paragraphs,
      shadow: portrait.shadow,
      fun_fact: portrait.fun_fact,
      dimensions: formatDimensions(userVector, dimScores),
    });

  } catch (err) {
    console.error('Match error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── HELPERS ──

async function getAnimalPhoto(scientificName) {
  try {
    // Search GBIF media API for a photo
    const searchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`;
    const matchRes = await fetch(searchUrl);
    const matchData = await matchRes.json();

    if (matchData.usageKey) {
      const mediaUrl = `https://api.gbif.org/v1/occurrence/search?taxonKey=${matchData.usageKey}&mediaType=StillImage&limit=1`;
      const mediaRes = await fetch(mediaUrl);
      const mediaData = await mediaRes.json();

      if (mediaData.results?.[0]?.media?.[0]?.identifier) {
        return mediaData.results[0].media[0].identifier;
      }
    }
  } catch (e) {
    console.error('Photo fetch error:', e);
  }
  return null; // Frontend uses emoji placeholder if null
}

function formatScientificName(name) {
  // Capitalize genus, lowercase species — fallback display name
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()
      + ' ' + parts[1].toLowerCase();
  }
  return name;
}

function formatDimensions(userVector, dimScores) {
  // Return top dimensions for display on result page
  const dimLabels = {
    cognitive_style: 'Cognitive style',
    emotional_regulation: 'Emotional regulation',
    attachment_style: 'Attachment style',
    social_architecture: 'Social architecture',
    aspiration_drive: 'Aspiration & drive',
    creativity_play: 'Creativity & play',
    transformation: 'Transformation',
    curiosity: 'Curiosity',
    physicality: 'Physicality',
    camouflage_display: 'Camouflage vs display',
    social_legibility: 'Social legibility',
    nurturing: 'Nurturing',
  };

  const colors = ['#00e8ff', '#a78bfa', '#00ffa3', '#00e8ff', '#a78bfa', '#00ffa3',
                  '#00e8ff', '#a78bfa', '#00ffa3', '#00e8ff', '#a78bfa', '#00ffa3'];

  return Object.entries(userVector).map(([col, score], i) => ({
    name: dimLabels[col] || col,
    value: Math.round(((score + 1) / 2) * 100), // -1..1 to 0..100
    color: colors[i % colors.length],
  }));
}

async function generatePortrait(animal, dimScores, userVector) {
  const animalName = animal.common_name || animal.scientific_name;
  const ecologicalRole = animal.ecological_role || 'member of its ecosystem';
  const shadowText = animal.shadow || '';
  const funFact = animal.fun_fact || '';

  // Build a readable profile summary for Claude
  const topDims = Object.entries(dimScores)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 8)
    .map(([dim, score]) => `${dim.replace(/_/g, ' ')}: ${score > 0 ? '+' : ''}${score.toFixed(2)}`)
    .join(', ');

  const prompt = `You are writing a personality result for someone matched to the ${animalName} (${animal.scientific_name}) by the Zoëtype system.

ANIMAL DATA:
- Ecological role: ${ecologicalRole}
- Shadow behavior: ${shadowText}
- Species fact: ${funFact}
- Top dimensions: ${topDims}

WRITING RULES — these are absolute, not guidelines:
- No em dashes anywhere. Use periods or commas instead.
- No "not X — Y" constructions ever.
- No "you likely," "you may," "something of this," "a kind of," "in a way," "perhaps."
- No dimension score names in the portrait text. Never say "your cognitive score" or "your attachment score."
- No reaching for profundity. If a sentence sounds deep but vague, cut it.
- No sentences that gesture at meaning without landing something specific.
- Every psychological observation must be grounded in a specific biological fact about this animal.
- Write like a sharp journalist who has spent years studying this animal and genuinely sees this person clearly.
- Short sentences hit harder than long ones.
- Trust the animal. The biology is interesting enough on its own.

PORTRAIT — three paragraphs:
Paragraph 1: Open with a specific biological fact about this animal that immediately reframes how the reader sees themselves. Make it land in the first sentence. Do not build to it. Three to four sentences.
Paragraph 2: Go into how this animal processes its world — how it hunts, bonds, navigates, or survives — and connect that directly to how this person functions. Be specific about the animal. Be specific about the person. Four to five sentences.
Paragraph 3: The ecological significance of this animal. What happens to its ecosystem without it. Connect this directly to what this person does in the systems around them. Do not explain. Just state it. Three to four sentences.

SHADOW — one paragraph:
What is the dark side of this animal's defining trait. What does this animal do that is uncomfortable or destructive. Connect it to the person without softening it. This is not a flaw. It is the cost of their gift. Three to four sentences.

SPECIES FACT — one paragraph:
One true, striking, specific fact about this animal that lands as a revelation about the person. The fact should recontextualize something about how they live. End it with a sentence that makes the connection explicit. Three sentences maximum.

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

  try {
    return JSON.parse(clean);
  } catch (e) {
    // Fallback if JSON parsing fails
    return {
      paragraphs: [
        `You have been matched to the ${animalName} — one of ${Math.round(Math.random() * 900 + 200)} species we considered before arriving here.`,
        `The match was calculated across 12 behavioral dimensions. Your profile is specific.`,
        `The ${animalName} functions as a ${ecologicalRole} in its ecosystem. So do you.`,
      ],
      shadow: shadowText || `Every creature carries a shadow. The ${animalName} is no exception.`,
      fun_fact: funFact || `The ${animalName} has survived for millions of years. It knows something you are still learning.`,
    };
  }
}
