/**
 * WHAT ANIMAL ARE YOU? -- MATCHING ENGINE
 *
 * Express API server with two endpoints:
 *
 * POST /api/match
 *   Receives completed test answers
 *   Converts answers to a 24-dimension human vector
 *   Finds the closest species in the database
 *   Generates the full result with Claude
 *   Returns the complete result
 *
 * GET /api/species/:id
 *   Returns full species data for a given ID
 *
 * Deploy to Vercel: vercel deploy
 */

import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// ANSWER-TO-DIMENSION SCORING
//
// Each question maps to one or more dimensions.
// Each answer option maps to a score on that dimension's spectrum.
// Some questions contribute to multiple dimensions (the web).
// ============================================================

const QUESTION_DIMENSION_MAP = {
  // Q1: Cognitive Style - problem solving approach
  1: {
    primary: { dim: "cognitive_style", scores: [0.8, 0.5, 0.3, 0.7] },
  },
  // Q2: Cognitive Style - learning behavior
  2: {
    primary: { dim: "cognitive_style", scores: [0.85, 0.4, 0.6, 0.75] },
  },
  // Q3: Cognitive Style - pattern recognition
  3: {
    primary: { dim: "cognitive_style", scores: [0.75, 0.5, 0.4, 0.3] },
  },
  // Q4: Cognitive Style - processing speed and pressure
  4: {
    primary: { dim: "cognitive_style", scores: [0.7, 0.5, 0.3, 0.6] },
  },
  // Q5: Cognitive Style - breadth vs depth
  5: {
    primary: { dim: "cognitive_style", scores: [0.8, 0.35, 0.4, 0.75] },
  },
  // Q6: Emotional Regulation - reactivity
  6: {
    primary: { dim: "emotional_regulation", scores: [0.2, 0.4, 0.7, 0.3] },
  },
  // Q7: Emotional Regulation - recovery speed
  7: {
    primary: { dim: "emotional_regulation", scores: [0.8, 0.6, 0.3, 0.5] },
  },
  // Q8: Emotional Regulation - regulation strategy
  8: {
    primary: { dim: "emotional_regulation", scores: [0.3, 0.7, 0.5, 0.4] },
    secondary: { dim: "social_architecture", scores: [0.2, 0.7, 0.6, 0.3] },
  },
  // Q9: Emotional Regulation - baseline presentation
  9: {
    primary: { dim: "emotional_regulation", scores: [0.8, 0.6, 0.4, 0.2] },
    secondary: { dim: "camouflage_display", scores: [0.3, 0.7, 0.2, 0.8] },
  },
  // Q10: Emotional Regulation - tolerance for unresolved tension
  10: {
    primary: { dim: "emotional_regulation", scores: [0.7, 0.3, 0.5, 0.4] },
  },
  // Q11: Attachment Style - separation response
  11: {
    primary: { dim: "attachment_style", scores: [0.5, 0.8, 0.2, 0.6] },
  },
  // Q12: Attachment Style - relationship stress response
  12: {
    primary: { dim: "attachment_style", scores: [0.7, 0.3, 0.8, 0.4] },
  },
  // Q13: Attachment Style - bond dissolution
  13: {
    primary: { dim: "attachment_style", scores: [0.6, 0.2, 0.85, 0.75] },
  },
  // Q14: Attachment Style - dependency on connection
  14: {
    primary: { dim: "attachment_style", scores: [0.2, 0.6, 0.85, 0.4] },
    secondary: { dim: "social_architecture", scores: [0.1, 0.5, 0.9, 0.6] },
  },
  // Q15: Attachment Style - response to closeness
  15: {
    primary: { dim: "attachment_style", scores: [0.8, 0.3, 0.5, 0.6] },
  },
  // Q16: Social Architecture - circle size
  16: {
    primary: { dim: "social_architecture", scores: [0.2, 0.5, 0.8, 0.05] },
  },
  // Q17: Social Architecture - solitary recharge
  17: {
    primary: { dim: "social_architecture", scores: [0.1, 0.4, 0.7, 0.9] },
  },
  // Q18: Social Architecture - disclosure patterns
  18: {
    primary: { dim: "social_architecture", scores: [0.3, 0.4, 0.8, 0.1] },
    secondary: { dim: "camouflage_display", scores: [0.4, 0.5, 0.8, 0.1] },
  },
  // Q19: Social Architecture - loyalty intensity
  19: {
    primary: { dim: "social_architecture", scores: [0.3, 0.5, 0.7, 0.2] },
    secondary: { dim: "attachment_style", scores: [0.85, 0.6, 0.5, 0.3] },
  },
  // Q20: Social Architecture - daily life with others (slider 0-100 → 0-1)
  20: {
    primary: { dim: "social_architecture", slider: true },
  },
  // Q21: Origin - geographic environment
  21: {
    primary: { dim: "origin", scores: [0.8, 0.6, 0.4, 0.2] },
  },
  // Q22: Origin - economic environment
  22: {
    primary: { dim: "origin", scores: [0.8, 0.6, 0.4, 0.3] },
    secondary: { dim: "resources_work", scores: [0.3, 0.5, 0.8, 0.6] },
  },
  // Q23: Origin - home stability
  23: {
    primary: { dim: "origin", scores: [0.8, 0.6, 0.3, 0.1] },
    secondary: { dim: "emotional_regulation", scores: [0.7, 0.6, 0.4, 0.2] },
  },
  // Q24: Origin - age of independence
  24: {
    primary: { dim: "origin", scores: [0.2, 0.5, 0.8, 0.95] },
  },
  // Q25: Origin - distance from origin
  25: {
    primary: { dim: "origin", scores: [0.1, 0.4, 0.7, 0.9] },
    secondary: { dim: "transformation", scores: [0.8, 0.6, 0.3, 0.5] },
  },
  // Q26: Sexuality - number of serious relationships
  26: {
    primary: { dim: "sexuality_intimacy", scores: [0.3, 0.5, 0.6, 0.8] },
  },
  // Q27: Sexuality - meaning of intimacy
  27: {
    primary: { dim: "sexuality_intimacy", scores: [0.2, 0.85, 0.5, 0.4] },
  },
  // Q28: Sexuality - bonding speed
  28: {
    primary: { dim: "sexuality_intimacy", scores: [0.8, 0.3, 0.5, 0.2] },
    secondary: { dim: "attachment_style", scores: [0.8, 0.3, 0.5, 0.15] },
  },
  // Q29: Sexuality - orientation
  29: {
    primary: { dim: "sexuality_intimacy", scores: [0.5, 0.6, 0.7, 0.6] },
    secondary: { dim: "social_legibility", scores: [0.8, 0.5, 0.6, 0.5] },
  },
  // Q30: Sexuality - physical intimacy need (slider)
  30: {
    primary: { dim: "sexuality_intimacy", slider: true },
  },
  // Q31: Institutional - rule following
  31: {
    primary: { dim: "institutional_political", scores: [0.1, 0.4, 0.7, 0.9] },
  },
  // Q32: Institutional - personal experience with institutions
  32: {
    primary: { dim: "institutional_political", scores: [0.8, 0.5, 0.2, 0.4] },
  },
  // Q33: Institutional - individual vs systemic
  33: {
    primary: { dim: "institutional_political", scores: [0.2, 0.8] },
  },
  // Q34: Institutional - change orientation
  34: {
    primary: { dim: "institutional_political", scores: [0.2, 0.8, 0.5, 0.5] },
    secondary: { dim: "transformation", scores: [0.2, 0.8, 0.4, 0.5] },
  },
  // Q35: Institutional - relationship to authority
  35: {
    primary: { dim: "institutional_political", scores: [0.5, 0.2, 0.5, 0.1] },
  },
  // Q36: Moral - justice response
  36: {
    primary: { dim: "moral_conflict", scores: [0.9, 0.6, 0.3, 0.2] },
  },
  // Q37: Moral - conflict approach
  37: {
    primary: { dim: "moral_conflict", scores: [0.9, 0.5, 0.3, 0.1] },
  },
  // Q38: Moral - physical fight history
  38: {
    primary: { dim: "moral_conflict", scores: [0.9, 0.7, 0.5, 0.2] },
    secondary: { dim: "physicality_embodiment", scores: [0.8, 0.7, 0.5, 0.3] },
  },
  // Q39: Moral - reactivity threshold
  39: {
    primary: { dim: "moral_conflict", scores: [0.9, 0.3, 0.2] },
  },
  // Q40: Moral - justice orientation
  40: {
    primary: { dim: "moral_conflict", scores: [0.5, 0.8, 0.4, 0.3] },
  },
  // Q41: Resources - work as identity
  41: {
    primary: { dim: "resources_work", scores: [0.8, 0.5, 0.3, 0.4] },
    secondary: { dim: "legacy_orientation", scores: [0.7, 0.5, 0.3, 0.4] },
  },
  // Q42: Resources - specialist vs generalist
  42: {
    primary: { dim: "resources_work", scores: [0.2, 0.8, 0.5, 0.4] },
    secondary: { dim: "curiosity_knowledge", scores: [0.3, 0.8, 0.6, 0.4] },
  },
  // Q43: Resources - sharing vs hoarding
  43: {
    primary: { dim: "resources_work", scores: [0.8, 0.2, 0.6, 0.4] },
  },
  // Q44: Resources - competition orientation
  44: {
    primary: { dim: "resources_work", scores: [0.8, 0.5, 0.3, 0.2] },
    secondary: { dim: "institutional_political", scores: [0.2, 0.4, 0.6, 0.7] },
  },
  // Q45: Resources - work rhythm
  45: {
    primary: { dim: "resources_work", scores: [0.6, 0.8, 0.4, 0.7] },
    secondary: { dim: "biological_rhythms", scores: [0.5, 0.8, 0.3, 0.7] },
  },
  // Q46: Biological Rhythms - wake time
  46: {
    primary: { dim: "biological_rhythms", scores: [0.1, 0.4, 0.8, 0.5] },
  },
  // Q47: Biological Rhythms - peak thinking time
  47: {
    primary: { dim: "biological_rhythms", scores: [0.1, 0.4, 0.7, 0.9] },
  },
  // Q48: Biological Rhythms - birth season
  48: {
    primary: { dim: "biological_rhythms", scores: [0.6, 0.3, 0.7, 0.4] },
  },
  // Q49: Biological Rhythms - seasonal sensitivity
  49: {
    primary: { dim: "biological_rhythms", scores: [0.8, 0.6, 0.3, 0.7] },
  },
  // Q50: Biological Rhythms - sleep need
  50: {
    primary: { dim: "biological_rhythms", scores: [0.3, 0.5, 0.8, 0.5] },
  },
  // Q51: Aspiration - drive source
  51: {
    primary: { dim: "aspiration_drive", scores: [0.8, 0.6, 0.2, 0.7] },
  },
  // Q52: Aspiration - failure response
  52: {
    primary: { dim: "aspiration_drive", scores: [0.8, 0.5, 0.3, 0.6] },
    secondary: { dim: "emotional_regulation", scores: [0.7, 0.5, 0.3, 0.8] },
  },
  // Q53: Aspiration - intrinsic vs extrinsic motivation
  53: {
    primary: { dim: "aspiration_drive", scores: [0.9, 0.6, 0.3, 0.5] },
    secondary: { dim: "camouflage_display", scores: [0.3, 0.5, 0.8, 0.5] },
  },
  // Q54: Time - temporal orientation
  54: {
    primary: { dim: "relationship_time", scores: [0.8, 0.5, 0.7, 0.5] },
  },
  // Q55: Time - planning vs spontaneity
  55: {
    primary: { dim: "relationship_time", scores: [0.5, 0.7, 0.5, 0.3] },
  },
  // Q56: Time - pace of time
  56: {
    primary: { dim: "relationship_time", scores: [0.7, 0.3, 0.5, 0.4] },
    secondary: { dim: "mortality", scores: [0.7, 0.3, 0.5, 0.2] },
  },
  // Q57: Creativity - problem approach
  57: {
    primary: { dim: "creativity_play", scores: [0.9, 0.3, 0.5, 0.4] },
  },
  // Q58: Creativity - adult play
  58: {
    primary: { dim: "creativity_play", scores: [0.9, 0.6, 0.3, 0.1] },
  },
  // Q59: Creativity - making motivation
  59: {
    primary: { dim: "creativity_play", scores: [0.7, 0.9, 0.5, 0.2] },
    secondary: { dim: "legacy_orientation", scores: [0.6, 0.5, 0.7, 0.2] },
  },
  // Q60: Aesthetics - environment sensitivity
  60: {
    primary: { dim: "beauty_aesthetics", scores: [0.9, 0.6, 0.2, 0.3] },
  },
  // Q61: Aesthetics - sensory channel
  61: {
    primary: { dim: "beauty_aesthetics", scores: [0.7, 0.8, 0.6, 0.4] },
  },
  // Q62: Aesthetics - clean vs dark (slider)
  62: {
    primary: { dim: "beauty_aesthetics", slider: true },
    secondary: { dim: "shadow", slider: true },
  },
  // Q63: Transformation - degree of change
  63: {
    primary: { dim: "transformation", scores: [0.7, 0.9, 0.5, 0.2] },
  },
  // Q64: Transformation - endings
  64: {
    primary: { dim: "transformation", scores: [0.6, 0.8, 0.4, 0.7] },
    secondary: { dim: "attachment_style", scores: [0.6, 0.2, 0.8, 0.7] },
  },
  // Q65: Transformation - seeking change
  65: {
    primary: { dim: "transformation", scores: [0.9, 0.6, 0.4, 0.2] },
  },
  // Q66: Curiosity - response to not knowing
  66: {
    primary: { dim: "curiosity_knowledge", scores: [0.9, 0.5, 0.3, 0.1] },
  },
  // Q67: Curiosity - relationship to open questions
  67: {
    primary: { dim: "curiosity_knowledge", scores: [0.9, 0.6, 0.4, 0.2] },
  },
  // Q68: Curiosity - response to being wrong
  68: {
    primary: { dim: "curiosity_knowledge", scores: [0.9, 0.6, 0.3, 0.5] },
  },
  // Q69: Physicality - body presence
  69: {
    primary: { dim: "physicality_embodiment", scores: [0.9, 0.6, 0.2, 0.3] },
  },
  // Q70: Physicality - risk relationship
  70: {
    primary: { dim: "physicality_embodiment", scores: [0.9, 0.6, 0.3, 0.4] },
    secondary: { dim: "moral_conflict", scores: [0.7, 0.5, 0.3, 0.4] },
  },
  // Q71: Physicality - relationship to food
  71: {
    primary: { dim: "physicality_embodiment", scores: [0.8, 0.3, 0.5, 0.6] },
  },
  // Q72: Physicality - substances
  72: {
    primary: { dim: "physicality_embodiment", scores: [0.8, 0.6, 0.3, 0.2] },
    secondary: { dim: "shadow", scores: [0.6, 0.4, 0.3, 0.2] },
  },
  // Q73: Shadow - what you judge in others
  73: {
    primary: { dim: "shadow", scores: [0.5, 0.6, 0.7, 0.4, 0.8, 0.65] },
  },
  // Q74: Shadow - public vs private self
  74: {
    primary: { dim: "shadow", scores: [0.2, 0.5, 0.8, 0.9] },
    secondary: { dim: "camouflage_display", scores: [0.8, 0.5, 0.2, 0.3] },
  },
  // Q75: Shadow - handling unexplained feelings
  75: {
    primary: { dim: "shadow", scores: [0.2, 0.5, 0.6, 0.8] },
  },
  // Q76: Shadow - causing harm
  76: {
    primary: { dim: "shadow", scores: [0.3, 0.6, 0.3] },
  },
  // Q77: Mortality - frequency of thinking about death
  77: {
    primary: { dim: "mortality", scores: [0.9, 0.6, 0.3, 0.1] },
  },
  // Q78: Mortality - loss experience
  78: {
    primary: { dim: "mortality", scores: [0.8, 0.5, 0.7, 0.3] },
  },
  // Q79: Mortality - year to live response
  79: {
    primary: { dim: "mortality", scores: [0.6, 0.7, 0.8, 0.2] },
    secondary: { dim: "aspiration_drive", scores: [0.3, 0.6, 0.8, 0.2] },
  },
  // Q80: Legacy - thinking about leaving behind
  80: {
    primary: { dim: "legacy_orientation", scores: [0.9, 0.5, 0.3, 0.1] },
  },
  // Q81: Legacy - type of legacy
  81: {
    primary: { dim: "legacy_orientation", scores: [0.7, 0.8, 0.6, 0.1] },
  },
  // Q82: Legacy - sacrifice for future
  82: {
    primary: { dim: "legacy_orientation", scores: [0.9, 0.6, 0.3, 0.5] },
  },
  // Q83: Ecological Role - impact when leaving
  83: {
    primary: { dim: "ecological_role", scores: [0.9, 0.5, 0.2, 0.4] },
  },
  // Q84: Ecological Role - function type
  84: {
    primary: { dim: "ecological_role", scores: [0.8, 0.7, 0.6, 0.5, 0.9] },
  },
  // Q85: Ecological Role - dependency
  85: {
    primary: { dim: "ecological_role", scores: [0.9, 0.6, 0.3, 0.2] },
  },
  // Q86: Camouflage vs Display - being watched
  86: {
    primary: { dim: "camouflage_display", scores: [0.9, 0.6, 0.2, 0.5] },
  },
  // Q87: Camouflage vs Display - inner life visibility
  87: {
    primary: { dim: "camouflage_display", scores: [0.9, 0.5, 0.2, 0.6] },
    secondary: { dim: "shadow", scores: [0.2, 0.4, 0.7, 0.5] },
  },
  // Q88: Camouflage vs Display - deliberate invisibility
  88: {
    primary: { dim: "camouflage_display", scores: [0.3, 0.4, 0.8, 0.2] },
  },
  // Q89: Social Legibility - stranger accuracy
  89: {
    primary: { dim: "social_legibility", scores: [0.8, 0.5, 0.2, 0.5] },
  },
  // Q90: Social Legibility - performing normalcy
  90: {
    primary: { dim: "social_legibility", scores: [0.2, 0.4, 0.6, 0.9] },
    secondary: { dim: "shadow", scores: [0.7, 0.5, 0.3, 0.2] },
  },
  // Q91: Social Legibility - community where understood
  91: {
    primary: { dim: "social_legibility", scores: [0.4, 0.3, 0.2, 0.8] },
  },
  // Q92: Spirituality - transcendent experience
  92: {
    primary: { dim: "spirituality", scores: [0.9, 0.6, 0.4, 0.1] },
  },
  // Q93: Spirituality - what you bow to
  93: {
    primary: { dim: "spirituality", scores: [0.7, 0.5, 0.9, 0.3, 0.1] },
  },
  // Q94: Spirituality - nature relationship
  94: {
    primary: { dim: "spirituality", scores: [0.8, 0.3, 0.9, 0.1] },
  },
};

// ============================================================
// CONVERT ANSWERS TO HUMAN VECTOR
// ============================================================

function answersToVector(answers) {
  // Initialize all dimensions to null (no data)
  const dims = {
    cognitive_style: [], emotional_regulation: [], attachment_style: [],
    social_architecture: [], origin: [], sexuality_intimacy: [],
    institutional_political: [], moral_conflict: [], resources_work: [],
    biological_rhythms: [], aspiration_drive: [], relationship_time: [],
    creativity_play: [], beauty_aesthetics: [], transformation: [],
    curiosity_knowledge: [], physicality_embodiment: [], shadow: [],
    mortality: [], legacy_orientation: [], ecological_role: [],
    camouflage_display: [], social_legibility: [], spirituality: [],
  };

  for (const [qId, answer] of Object.entries(answers)) {
    const mapping = QUESTION_DIMENSION_MAP[parseInt(qId)];
    if (!mapping) continue;

    for (const [role, config] of Object.entries(mapping)) {
      if (!config) continue;

      let score;
      if (config.slider) {
        // Slider answer is 0-100, normalize to 0-1
        score = (answer / 100);
      } else if (config.scores && answer !== undefined && config.scores[answer] !== undefined) {
        score = config.scores[answer];
      }

      if (score !== undefined && dims[config.dim]) {
        dims[config.dim].push(score);
      }
    }
  }

  // Average scores for each dimension
  // Dimensions with no data default to 0.5 (middle of spectrum)
  const dimOrder = [
    "cognitive_style", "emotional_regulation", "attachment_style",
    "social_architecture", "origin", "sexuality_intimacy",
    "institutional_political", "moral_conflict", "resources_work",
    "biological_rhythms", "aspiration_drive", "relationship_time",
    "creativity_play", "beauty_aesthetics", "transformation",
    "curiosity_knowledge", "physicality_embodiment", "shadow",
    "mortality", "legacy_orientation", "ecological_role",
    "camouflage_display", "social_legibility", "spirituality",
  ];

  return dimOrder.map(dim => {
    const scores = dims[dim];
    if (!scores || scores.length === 0) return 0.5;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  });
}

// ============================================================
// GENERATE FULL RESULT WITH CLAUDE
// ============================================================

async function generateResult(humanVector, species, dimensionScores) {
  const dimNames = [
    "cognitive style", "emotional regulation", "attachment style",
    "social architecture", "origin", "sexuality and intimacy",
    "institutional and political orientation", "moral orientation and conflict",
    "relationship to resources and work", "biological rhythms",
    "aspiration and drive", "relationship to time", "creativity and play",
    "relationship to beauty and aesthetics", "relationship to transformation",
    "curiosity and knowledge", "physicality and embodiment", "the shadow",
    "relationship to mortality", "legacy orientation", "ecological role",
    "camouflage vs display", "social legibility", "spirituality and transcendence",
  ];

  // Find the top 8 closest matching dimensions
  const dimensionMatches = humanVector.map((humanScore, i) => ({
    name: dimNames[i],
    humanScore,
    speciesScore: species.dimension_vector ? species.dimension_vector[i] : 0.5,
    distance: Math.abs(humanScore - (species.dimension_vector ? species.dimension_vector[i] : 0.5)),
  }))
  .sort((a, b) => a.distance - b.distance)
  .slice(0, 8);

  const prompt = `
You are generating the result for someone who just completed an in-depth personality test.
They have been matched to a specific animal species based on 24 personality dimensions.

THE MATCHED ANIMAL:
Common name: ${species.common_name || species.latin_name}
Latin name: ${species.latin_name}
Kingdom: ${species.kingdom}
Class: ${species.class}
Habitat: ${species.habitat || "various habitats"}

BASE PORTRAIT (expand and personalize this):
${species.result_portrait || ""}

SHADOW (the difficulty of being this animal):
${species.result_shadow || ""}

THE 8 DIMENSIONS WHERE THIS PERSON MOST CLOSELY MATCHES THIS ANIMAL:
${dimensionMatches.map(d => `- ${d.name}: person scored ${d.humanScore.toFixed(2)}, animal scored ${d.speciesScore.toFixed(2)}`).join("\n")}

Generate a complete, vivid, and deeply personal result. This person just spent 20+ minutes answering 94 questions. The result needs to be a genuine payoff.

Write in second person ("You are..."). Be specific about the animal. Be honest. Do not be generic.

Structure your response as JSON with these fields:

{
  "headline": "One powerful sentence that captures the essence of this match",
  "portrait": "4-5 paragraphs describing how this animal lives and why it mirrors this person. Specific biological and behavioral details. Written like the most interesting thing they have ever read about themselves.",
  "dimension_highlights": [
    {
      "dimension": "dimension name",
      "animal_behavior": "what this animal does",
      "human_mirror": "how this reflects the person",
      "insight": "the deeper meaning of this connection"
    }
  ],
  "shadow": "2 paragraphs on the genuine difficulty of being this animal and what that means for this person. Honest. Not harsh. Not flattering.",
  "closing": "One paragraph that lands the result with weight. Something they will remember."
}

Include 5-6 dimension highlights. Make every sentence earn its place.
Respond ONLY with valid JSON.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ============================================================
// API ENDPOINTS
// ============================================================

/**
 * POST /api/match
 * Body: { answers: { [questionId]: answerIndex } }
 * Returns: { species, result, matchScore }
 */
app.post("/api/match", async (req, res) => {
  try {
    const { answers, sessionId } = req.body;

    if (!answers || Object.keys(answers).length < 10) {
      return res.status(400).json({ error: "Insufficient answers to generate a match" });
    }

    // Convert answers to 24-dimension vector
    const humanVector = answersToVector(answers);

    // Find closest species in database
    const vectorString = `[${humanVector.join(",")}]`;

    const { data: matches, error } = await supabase.rpc("match_species", {
      query_vector: vectorString,
      match_count: 3,
      min_confidence: 0.3,
    });

    if (error) throw error;
    if (!matches || matches.length === 0) {
      return res.status(404).json({ error: "No match found. Database may still be populating." });
    }

    const topMatch = matches[0];

    // Generate full result with Claude
    const result = await generateResult(humanVector, topMatch, answers);

    // Store the result
    if (sessionId) {
      await supabase.from("test_results").insert({
        session_id: sessionId,
        species_id: topMatch.id,
        human_vector: vectorString,
        match_score: topMatch.similarity,
        result_text: JSON.stringify(result),
      });
    }

    res.json({
      species: {
        id: topMatch.id,
        commonName: topMatch.common_name,
        latinName: topMatch.latin_name,
        kingdom: topMatch.kingdom,
        class: topMatch.class,
        habitat: topMatch.habitat,
        imageUrl: topMatch.image_url,
      },
      result,
      matchScore: topMatch.similarity,
      humanVector,
    });

  } catch (err) {
    console.error("Match error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/species/:id
 * Returns full species data
 */
app.get("/api/species/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("species")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats
 * Returns database statistics
 */
app.get("/api/stats", async (req, res) => {
  try {
    const { count } = await supabase
      .from("species")
      .select("*", { count: "exact", head: true });

    res.json({
      speciesCount: count,
      message: `Database contains ${count} tagged species`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Matching engine running on port ${PORT}`);
});

export default app;
