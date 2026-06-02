// ZOETYPE MATCHING ENGINE
// Vercel serverless function — POST /api/match
// Body: { answers: { questionId: answerValue, ... } }
// Returns: { animal, portrait, shadow, fun_fact, dimensions }

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');
const { scoreAnswers, buildMatchVector, cosineSimilarity, MATCH_COLUMNS } = require('../scoring');

const resend = new Resend(process.env.RESEND_API_KEY);

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

    // STEP 4b: Save user data if provided
    const { user } = req.body;
    if (user && user.email) {
      // Save to users table
      await supabase.from('zoetype_users').insert({
        first_name: user.firstName || null,
        email: user.email,
        age_range: user.age || null,
        gender: user.gender || null,
        animal_matched: bestMatch.scientific_name,
        match_score: Math.round(bestScore * 100),
      }).then(({ error }) => {
        if (error) console.error('User save error:', error);
      });
    }

    // STEP 5: Get animal photo from GBIF
    const photoUrl = await getAnimalPhoto(bestMatch.scientific_name);

    // STEP 6: Generate personalized portrait using Claude
    const portrait = await generatePortrait(bestMatch, dimScores, userVector);

    // STEP 6b: Save full result to sessions table for email checkout
    if (user && user.email) {
      await supabase.from('zoetype_sessions').insert({
        email: user.email,
        first_name: user.firstName || null,
        animal_name: bestMatch.common_name || bestMatch.scientific_name,
        scientific_name: bestMatch.scientific_name,
        photo_url: photoUrl || null,
        portrait: portrait,
        shadow: portrait.shadow || null,
        fun_fact: portrait.fun_fact || null,
        answers: req.body.answers || null,
      }).then(({ error }) => {
        if (error) console.error('Session save error:', error);
      });
    }

    // STEP 6b: Save full result to sessions table for email checkout link
    if (user && user.email) {
      supabase.from('zoetype_sessions').insert({
        email: user.email,
        first_name: user.firstName || null,
        animal_name: bestMatch.common_name || bestMatch.scientific_name,
        scientific_name: bestMatch.scientific_name,
        photo_url: photoUrl || null,
        portrait: portrait,
        shadow: portrait.shadow || null,
        fun_fact: portrait.fun_fact || null,
        answers: req.body.answers || null,
      }).then(({ error }) => {
        if (error) console.error('Session save error:', error);
      });
    }

    // STEP 7: Send result email if user provided email
    if (user && user.email) {
      const firstName = user.firstName || 'there';
      const animalName = bestMatch.common_name || bestMatch.scientific_name;
      const emailHtml = buildResultEmail(firstName, animalName, bestMatch.scientific_name, portrait, photoUrl, user.email);
      
      resend.emails.send({
        from: 'Zoëtype <onboarding@resend.dev>',
        to: user.email,
        subject: `Your Zoëtype result: ${animalName}`,
        html: emailHtml,
      }).catch(err => console.error('Email error:', err));
    }

    // STEP 8: Return full result
    return res.status(200).json({
      user_first_name: user?.firstName || null,
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
    const searchUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`;
    const matchRes = await fetch(searchUrl);
    const matchData = await matchRes.json();

    if (matchData.usageKey) {
      // Fetch 50 results so we can find the most-photographed occurrence
      const mediaUrl = `https://api.gbif.org/v1/occurrence/search?taxonKey=${matchData.usageKey}&mediaType=StillImage&limit=50`;
      const mediaRes = await fetch(mediaUrl);
      const mediaData = await mediaRes.json();

      const results = mediaData.results || [];

      // Score each result — prefer high occurrence count (more observations = more likely quality photo)
      // and filter out non-photo URLs
      const badKeywords = ['graph','chart','diagram','map','illustration','drawing','figure','schema','plot','svg','pdf','doc'];
      const goodExtensions = ['.jpg','.jpeg','.png','.webp'];

      let bestUrl = null;
      let bestScore = -1;

      for (const result of results) {
        const media = result.media || [];
        const occurrenceCount = result.individualCount || 1;

        for (const item of media) {
          const url = (item.identifier || '').toLowerCase();
          if (!url) continue;

          // Must have a photo extension
          const hasGoodExt = goodExtensions.some(ext => url.includes(ext));
          if (!hasGoodExt) continue;

          // Must not contain bad keywords
          const hasBadKeyword = badKeywords.some(kw => url.includes(kw));
          if (hasBadKeyword) continue;

          // Score by occurrence count — more sightings = more reliable photo
          const score = occurrenceCount;
          if (score > bestScore) {
            bestScore = score;
            bestUrl = item.identifier; // Use original case URL
          }
        }
      }

      if (bestUrl) return bestUrl;
    }
  } catch (e) {
    console.error('Photo fetch error:', e);
  }
  return null;
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

YOUR JOB:
Write a result that makes the person feel genuinely seen. The portrait should feel complete. Do not comment on what the portrait leaves out. Do not write sentences about what this page cannot cover. Do not narrate the portrait's own limitations. Just write the portrait. If you do your job well, the reader will naturally want more without being told they should want more.

ABSOLUTE WRITING RULES:
- Write entirely in second person. "You" throughout. No names appear in this portrait.
- No em dashes anywhere. Use periods or commas instead.
- No "not X — Y" constructions ever.
- No "you likely," "you may," "something of this," "a kind of," "in a way," "perhaps," "it seems."
- No dimension score names. Never write "your cognitive score" or "your attachment score."
- No vague profundity. Every sentence must land something specific.
- Every psychological observation must connect to a real biological fact about this animal.
- Write like a sharp journalist who knows this animal deeply and sees this person clearly.
- Short sentences hit harder than long ones.
- Do not summarize. Do not explain. State things.

PORTRAIT — three paragraphs:

Paragraph 1: Open with one specific biological fact about this animal that immediately reframes how the reader sees themselves. First sentence carries the weight. Do not build to it. Three to four sentences. End cleanly.

Paragraph 2: How this animal processes its world. How it hunts, bonds, navigates, or survives. Connect each observation directly to how this person functions. Be specific about the animal. Be specific about the person. Four to five sentences. End on a precise observation about this person — something true and specific, not vague.

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

function buildResultEmail(firstName, animalName, scientificName, portrait, photoUrl, userEmail) {
  const paragraphs = portrait.paragraphs || [];
  const shadow = portrait.shadow || '';
  const funFact = portrait.fun_fact || '';
  const photoHtml = photoUrl 
    ? `<img src="${photoUrl}" alt="${animalName}" style="width:100%;max-height:400px;object-fit:cover;display:block;margin-bottom:32px;">`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#03070e;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#03070e;">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      
      <!-- Header -->
      <tr><td style="padding:0 0 32px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
        <p style="margin:0;font-family:'Georgia',serif;font-size:18px;color:#e2e8f5;letter-spacing:0.06em;">Zoë<em style="color:#00e8ff;">type</em></p>
      </td></tr>

      <!-- Eyebrow -->
      <tr><td style="padding:40px 0 8px 0;">
        <p style="margin:0;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#4a5570;font-family:'Helvetica Neue',sans-serif;">Your Zoëtype</p>
      </td></tr>

      <!-- Animal Name -->
      <tr><td style="padding:0 0 4px 0;">
        <h1 style="margin:0;font-family:'Georgia',serif;font-size:52px;font-weight:300;color:#e2e8f5;line-height:1;">${animalName}</h1>
      </td></tr>

      <!-- Scientific Name -->
      <tr><td style="padding:0 0 32px 0;">
        <p style="margin:0;font-size:14px;font-style:italic;color:#4a5570;font-family:'Georgia',serif;">${scientificName}</p>
      </td></tr>

      <!-- Photo -->
      <tr><td>${photoHtml}</td></tr>

      <!-- Portrait -->
      ${paragraphs.map(p => `
      <tr><td style="padding:0 0 24px 0;">
        <p style="margin:0;font-family:'Georgia',serif;font-size:18px;font-weight:300;line-height:1.85;color:#8896b0;">${p}</p>
      </td></tr>`).join('')}

      <!-- Divider -->
      <tr><td style="padding:16px 0 32px 0;">
        <div style="width:40px;height:1px;background:rgba(255,112,200,0.4);"></div>
      </td></tr>

      <!-- Shadow -->
      <tr><td style="padding:0 0 8px 0;">
        <p style="margin:0;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#ff70c8;font-family:'Helvetica Neue',sans-serif;">Shadow trait</p>
      </td></tr>
      <tr><td style="padding:0 0 32px 0;">
        <p style="margin:0;font-family:'Georgia',serif;font-size:17px;font-weight:300;line-height:1.85;color:#8896b0;font-style:italic;">${shadow}</p>
      </td></tr>

      <!-- Fun Fact -->
      <tr><td style="padding:24px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);margin-bottom:40px;">
        <p style="margin:0 0 8px 0;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#00e8ff;font-family:'Helvetica Neue',sans-serif;">Species fact</p>
        <p style="margin:0;font-size:15px;line-height:1.85;color:#8896b0;font-family:'Georgia',serif;">${funFact}</p>
      </td></tr>

      <!-- Spacer -->
      <tr><td style="padding:8px 0;"></td></tr>

      <!-- CTA -->
      <tr><td style="padding:40px;background:rgba(167,139,250,0.06);border:1px solid rgba(167,139,250,0.15);text-align:center;">
        <p style="margin:0 0 8px 0;font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#a78bfa;font-family:'Helvetica Neue',sans-serif;">The full Zoëtype Report</p>
        <h2 style="margin:0 0 16px 0;font-family:'Georgia',serif;font-size:28px;font-weight:300;color:#e2e8f5;line-height:1.3;">There are things this email does not tell you.</h2>
        <p style="margin:0 0 24px 0;font-size:15px;line-height:1.8;color:#8896b0;font-family:'Helvetica Neue',sans-serif;">The full Zoëtype Report covers what you do with it. Fifteen pages written from your answers and your animal alone. How you love. How you work. What restores you and what depletes you.</p>
        <a href="https://zoetype.vercel.app/api/checkout-email?email=${encodeURIComponent(userEmail)}" style="display:inline-block;background:#00e8ff;color:#03070e;text-decoration:none;padding:14px 36px;font-size:12px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;font-family:'Helvetica Neue',sans-serif;">Get my full report — $12</a>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:32px 0;border-top:1px solid rgba(255,255,255,0.07);margin-top:40px;">
        <p style="margin:0;font-size:12px;color:#4a5570;font-family:'Helvetica Neue',sans-serif;">Zoëtype &nbsp;·&nbsp; Built on science, not archetypes &nbsp;·&nbsp; <a href="https://zoetype.vercel.app" style="color:#4a5570;">zoetype.vercel.app</a></p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}


// Note: Run this SQL in Supabase to create the users table:
// CREATE TABLE IF NOT EXISTS zoetype_users (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   first_name text,
//   email text,
//   age_range text,
//   gender text,
//   animal_matched text,
//   match_score integer,
//   created_at timestamptz DEFAULT now()
// );
