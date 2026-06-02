// ZOETYPE SCORING ENGINE
// Converts quiz answers into a 25-dimension profile vector
// Each dimension maps to -1.0 (low end of spectrum) to 1.0 (high end)

// Answer index to score mappings per question
// For choice questions: each answer option maps to a position on the spectrum
// For binary: 0 = -1.0, 1 = 1.0
// For slider: raw value 0-100 remapped to -1.0 to 1.0

function sliderToScore(value) {
  // 0-100 slider to -1.0 to 1.0
  return ((value / 100) * 2) - 1;
}

// DIMENSION SCORE MAPS
// Each entry: questionId -> array of scores per answer option (index matches option index)
const SCORE_MAP = {

  // ── COGNITIVE STYLE ──
  // Spectrum: hardwired/instinct (-1) to flexible/abstract reasoning (+1)
  C1: [-0.8, -0.2, 0.6, 0.3],   // gut / look at others / break down / sit with it
  C2: [0.7, 0.9, -0.2, -0.4],   // connect / go deep / tell someone / move on
  C3: [0.8, 0.9, 0.2, 0.6],     // hold many / go deep / methodical / bursts
  C4: [-0.7, 0.7],               // data=analytical / instinct=intuitive
  C5: 'slider',                  // worse under pressure (-1) to better (+1)

  // ── EMOTIONAL REGULATION ──
  // Spectrum: hair-trigger high reactivity (-1) to flat/suppressed (+1)
  // Middle = healthy buffering through social connection
  E1: [-0.8, -0.4, 0.6, -0.2],  // hard/fast / quiet inward / deal first / need to talk
  E2: [0.8, 0.3, -0.6, 0.0],    // bounce back / sleep on it / stays with me / depends
  E3: [0.9, 0.3, -0.5, -0.8],   // steady / open / private / intense
  E4: 'slider',                  // set aside (−1) to stays with me (+1)
  E5: [-0.3, 0.5],               // shut down / push through

  // ── ATTACHMENT STYLE ──
  // Spectrum: no attachment system (-1) to survival-level dependency on connection (+1)
  A1: [0.2, -0.7, 0.8, 0.1],    // assume busy / wonder if wrong / give space / reach out once
  A2: [0.6, -0.3, -0.7, -0.8],  // address directly / pull back / worry / wonder if worth it
  A3: [0.5, -0.3, -0.8, -0.5],  // grieve move on / cut off / long time / stay connected
  A4: 'slider',                  // alone recharge (-1) to not long at all (+1)
  A5: [0.9, -0.7],               // lean in / pull back

  // ── SOCIAL ARCHITECTURE ──
  // Spectrum: absolute solitary (-1) to eusocial collective (+1)
  S1: [-0.8, 0.2, 0.9, -0.9],   // 1-2 / handful / a lot / none
  S2: 'slider',                  // almost none (-1) to almost all (+1)
  S3: [-0.9, 0.0, 0.6, 0.8],    // restored / fine / ready for someone / noticeably off
  S4: [-0.5, 0.0, 0.9, -0.8],   // one person / small circle / most people / nobody

  // ── ORIGIN ──
  // Spectrum: resource-scarce chaotic natal environment (-1) to stable abundant (+1)
  O1: [0.8, 0.5, -0.2, -0.7],   // city / suburb / small town / rural
  O2: [0.9, 0.2, -0.6, -0.8],   // comfortable / modest / tight / varied/unstable
  O3: [0.9, 0.3, -0.5, -0.9],   // very stable / mostly stable / unstable / chaotic
  O4: [-0.8, 0.0, 0.5, 0.8],    // young independent / typical / later / still not
  O5: 'slider',                  // still close to origin (-1) to very far (+1)

  // ── SEXUALITY & INTIMACY ──
  // Spectrum: zero pair bonding (-1) to lifelong exclusive pair bonding (+1)
  I1: [-0.7, 0.9, 0.0, -0.3],   // primarily physical / how I feel closest / depends / complicated
  I2: [-0.6, 0.8, 0.3, -0.5],   // fast all in / slowly / varies / not sure
  I3: [-0.4, -0.7, 0.5, 0.8],   // different gender / same gender / across genders / gender not factor
  // Q I3 is orientation — scored on separate axis, still contributes to overall profile
  I4: 'slider',                  // very little (-1) to a great deal (+1)
  // Note: I3 and I4 IDs in approved bank are I4 and I5 — mapping accordingly
  I5: 'slider',

  // ── INSTITUTIONAL ORIENTATION ──
  // Spectrum: rigid hierarchy deference (-1) to anarchic/decentralized (+1)
  N1: [0.8, 0.3, -0.5, -0.8],   // follow anyway / proper channels / ignore / break openly
  N2: [0.8, 0.3, -0.5, -0.9],   // for me / mixed / against me / outside institutions
  N3: [0.6, -0.6],               // individual effort / systems shape outcomes
  N4: [0.7, -0.6, -0.3, 0.0],   // caution / openness / skepticism / depends
  N5: [0.5, -0.7, 0.0, -0.9],   // respect when earned / instinctively skeptical / neutral / hard time with any

  // ── MORAL ORIENTATION ──
  // Spectrum: functional non-aggression/flight (-1) to extreme rapid escalation (+1)
  M1: [0.9, 0.3, -0.4, -0.7],   // intervene directly / say something / stay out / find someone else
  M2: [0.8, 0.2, -0.5, -0.9],   // move toward / de-escalate / step back / remove self
  M3: [-0.8, 0.3, -0.3, -0.9],  // multiple times / once or twice / come close / never
  M4: 'slider',                  // react quickly (-1) to absorb a great deal (+1)
  M5: [0.3, 0.9, 0.0, -0.5],    // apology / consequences / understand / move on

  // ── RESOURCES & WORK ──
  // Spectrum: pure present-tense acquisition (-1) to extreme hoarding/scarcity orientation (+1)
  R1: [0.8, 0.3, -0.3, -0.5],   // huge part of identity / matters / what I do / figuring out
  R2: [0.8, -0.8],               // specialist / generalist
  R3: [0.8, -0.7, 0.3, -0.5],   // save / share / invest / spend
  R4: [0.7, -0.6, 0.0, 0.4],    // thrive on / tolerate / draining / avoid
  R5: [0.6, -0.5, 0.2, -0.3],   // long stretches / bursts / steady / reactive

  // ── BIOLOGICAL RHYTHMS ──
  // Spectrum: strictly nocturnal (-1) to strictly diurnal (+1)
  B1: [0.9, 0.3, -0.7, 0.0],    // before 7 / 7-9 / after 9 / varies
  B2: [0.8, 0.3, -0.4, -0.8],   // early morning / midday / late afternoon / late night
  B3: [0.8, 0.5, -0.2, 0.6],    // spring / summer / fall / winter
  B4: [0.7, -0.7],               // seasons affect me / consistent year round
  B5: [0.8, 0.2, -0.7, 0.0],    // 6 hrs / 7-8 / 9+ / varies

  // ── ASPIRATION & DRIVE ──
  // Spectrum: minimal goal-directed drive (-1) to total singular consuming drive (+1)
  D1: [0.9, 0.6, 0.4, -0.5],    // specific vision / away from something / work itself / not sure
  D2: [0.8, 0.0, -0.5, 0.3],    // get back up / need time / question whether right / hasn't stopped me
  D3: [0.9, -0.2],               // yes work sustains / absence wears on me

  // ── RELATIONSHIP TO TIME ──
  // Spectrum: pure present-moment (-1) to full mental time travel past+future (+1)
  T1: [0.6, -0.8, 0.8, 0.0],    // past / present / future / moves around
  T2: [-0.6, 0.6],               // fine with unknown / uncomfortable
  T3: 'slider',                  // slow oppressive (-1) to slipping away (+1)

  // ── CREATIVITY & PLAY ──
  // Spectrum: hardwired fixed behavior (-1) to intrinsically motivated creative play (+1)
  P1: [0.9, -0.5, 0.2, -0.3],   // somewhere nobody looked / what worked / gather info / ask someone
  P2: [0.9, 0.4, -0.3, -0.7],   // yes regularly / sometimes / rarely / not really
  P3: [0.5, 0.8],                // thing existing / process

  // ── BEAUTY & AESTHETICS ──
  // Spectrum: minimal sensory apparatus (-1) to aesthetic production as primary mechanism (+1)
  AE1: [0.9, 0.4, -0.5, -0.2],  // significantly / somewhat / not much / only when unpleasant
  AE2: 'image',                  // scored by which image chosen — 4 options mapped below
  AE3: 'slider',                 // clean/resolved (-1) to dark/difficult (+1)

  // ── TRANSFORMATION ──
  // Spectrum: completely fixed form (-1) to complete metamorphic dissolution (+1)
  TR1: [0.6, 0.9, 0.3, -0.5],   // once / multiple times / continuous / not changed
  TR2: [0.8, -0.3],              // seek deliberately / change finds me
  TR3: [0.6, 0.9, -0.5, 0.3],   // grieve fully / cut off / hold on / feel and keep moving

  // ── CURIOSITY ──
  // Spectrum: complete neophobia / fixed responses (-1) to compulsive neophilia (+1)
  K1: [0.9, -0.7],               // pulled toward / nothing particular
  K2: [0.9, 0.3, -0.2, -0.7],   // most interesting / frustrating but sit / prefer answer / don't spend time
  K3: [0.9, 0.3, -0.6, 0.0],    // find interesting / adjust move on / bothers me / depends

  // ── PHYSICALITY ──
  // Spectrum: minimal sensory experience (-1) to maximum physical embodiment (+1)
  PH1: 'slider',                 // mostly in head (-1) to constantly aware (+1)
  PH2: [0.9, 0.3, -0.6, 0.0],   // drawn to risk / tolerate / avoid / not thought about
  PH3: [0.8, -0.4, -0.2, 0.3],  // pleasure / fuel / complicated / social
  PH4: [-0.5, -0.6, 0.2, 0.5],  // regularly / occasionally / rarely / no

  // ── SHADOW ──
  // Spectrum: complete behavioral consistency / minimal shadow (-1) to dramatic public/private split (+1)
  SH1: [0.3, 0.5, 0.8, 0.6, -0.7, -0.5], // dishonesty / laziness / weakness / selfishness / cruelty / neediness
  SH2: 'slider',                 // consistent (-1) to significantly different (+1)
  SH3: [0.2, 0.5, 0.8, -0.6],   // sit with / push through / put into something / ignore
  SH4: [0.3, -0.5, 0.0],        // yes reckoned / yes still carrying / not aware

  // ── MORTALITY ──
  // Spectrum: complete absence of death avoidance / self sacrifice (-1) to full conscious mortality awareness (+1)
  MO1: [0.9, 0.4, -0.2, -0.7],  // regularly / sometimes / rarely / almost never
  MO2: [0.8, -0.3, 0.5, -0.5],  // changed how I live / not processed / made peace / not yet
  MO3: [-0.8, 0.7],              // almost everything would change / not much would change

  // ── LEGACY ──
  // Spectrum: zero legacy orientation (-1) to complete multi-generational ecosystem engineering (+1)
  L1: [0.9, -0.6],               // yes drives me / no focused on present
  L2: [0.6, 0.9, 0.7, -0.8],    // biological / creative / relational / don't think in terms
  L3: [0.9, 0.6, -0.4, 0.0],    // yes / would / not sure would / haven't been in position

  // ── ECOLOGICAL ROLE ──
  // Spectrum: minimal ecological function (-1) to keystone ecosystem engineer (+1)
  EC1: [0.9, 0.3, -0.5, 0.0],   // things change significantly / adjustment / not much / haven't been in groups
  EC2: 'image',                  // 5 image options mapped to scores
  EC3: 'slider',                 // not particularly (-1) to yes significantly (+1)

  // ── CAMOUFLAGE VS DISPLAY ──
  // Spectrum: complete invisibility/cryptic (-1) to maximum display (+1)
  CD1: [0.9, 0.3, -0.7, 0.0],   // alive when watched / fine / uncomfortable / depends
  CD2: 'slider',                 // very little visible (-1) to open book (+1)
  CD3: [-0.5, -0.8, 0.9, 0.3],  // yes protective / yes cost me / always took up space / always invisible

  // ── SOCIAL LEGIBILITY ──
  // Spectrum: universal unambiguous legibility (-1) to maximal identity fluidity (+1)
  SL1: [-0.8, 0.0, 0.8, 0.3],   // yes accurate / get some / frequently misread / no idea
  SL2: [-0.3, 0.8],             // yes regularly / no generally myself
  SL3: [-0.8, 0.3, 0.9, -0.5],  // yes central / yes not connected / foreign everywhere / understood most

  // ── SPIRITUALITY ──
  // Spectrum: pure stimulus-response / no transcendence (-1) to sustained transcendent experience (+1)
  SP1: [0.9, 0.5, 0.0, -0.7],   // yes stayed with me / something close / open to possibility / don't think in those terms
  SP2: 'image',                  // 5 image options
  SP3: 'image',                  // 4 image options

  // ── NURTURING ──
  // Spectrum: zero parental investment (-1) to complete self-sacrifice for offspring (+1)
  NU1: [0.9, 0.5, 0.3, -0.5],   // central experience / yes not how define / no but pull / no no pull
  NU2: [0.9, 0.3, -0.2, -0.8],  // strong instinct / assess / sympathy / not much
  NU3: 'slider',                 // drains me (-1) to deeply meaningful (+1)
};

// IMAGE QUESTION SCORE MAPS
// Maps selected image index to a dimension score
const IMAGE_SCORES = {
  AE2: [-0.5, 0.9, 0.3, -0.7],  // landscape=visual / piano=auditory / runner=kinesthetic / floating=none
  EC2: [0.9, 0.5, 0.7, 0.3, -0.5], // arch=keystone / bridge=connector / scaffolding=builder / river=decomposer / lightning=invasive
  SP2: [0.7, 0.5, 0.8, -0.5, -0.8], // dinner=relationships / craftsperson=work / forest_light=higher power / road=freedom / room=nothing sacred
  SP3: [0.9, 0.3, 0.7, -0.7],   // forest absorbed / picnic appreciation / meditate / city no relationship
};

// DIMENSION COLUMN MAPPING
// Maps our internal dimension names to the Supabase column names
const DIM_COLUMNS = {
  cognitive_style: 'cognitive_style',
  emotional_regulation: 'emotional_regulation',
  attachment_style: 'attachment_style',
  social_architecture: 'social_architecture',
  origin: null,                  // not in DB — used for context only
  sexuality_intimacy: null,      // not in DB — used for context only
  institutional: null,           // not in DB — used for context only
  moral_orientation: null,       // not in DB — used for context only
  resources: null,               // not in DB — used for context only
  bio_rhythms: null,             // not in DB — used for context only
  aspiration: 'aspiration_drive',
  time: null,                    // not in DB
  creativity: 'creativity_play',
  beauty: null,                  // not in DB
  transformation: 'transformation',
  curiosity: 'curiosity',
  physicality: 'physicality',
  shadow: 'shadow',              // shadow in DB is text — matching uses numeric score separately
  mortality: null,               // not in DB
  legacy: null,                  // not in DB
  ecological_role: 'ecological_role', // text in DB
  camouflage_display: 'camouflage_display',
  social_legibility: 'social_legibility',
  spirituality: null,            // not in DB
  nurturing: 'nurturing',
};

// DB COLUMNS USED FOR MATCHING (numeric only)
const MATCH_COLUMNS = [
  'cognitive_style',
  'emotional_regulation',
  'attachment_style',
  'social_architecture',
  'aspiration_drive',
  'creativity_play',
  'transformation',
  'curiosity',
  'physicality',
  'camouflage_display',
  'social_legibility',
  'nurturing',
];

// DIMENSION GROUPINGS
// Which questions contribute to which dimension score (averaged)
const DIM_QUESTIONS = {
  cognitive_style:    ['C1','C2','C3','C4','C5'],
  emotional_regulation: ['E1','E2','E3','E4','E5'],
  attachment_style:   ['A1','A2','A3','A4','A5'],
  social_architecture:['S1','S2','S3','S4'],
  origin:             ['O1','O2','O3','O4','O5'],
  sexuality_intimacy: ['I1','I2','I4','I5'],
  institutional:      ['N1','N2','N3','N4','N5'],
  moral_orientation:  ['M1','M2','M3','M4','M5'],
  resources:          ['R1','R2','R3','R4','R5'],
  bio_rhythms:        ['B1','B2','B3','B4','B5'],
  aspiration:         ['D1','D2','D3'],
  time:               ['T1','T2','T3'],
  creativity:         ['P1','P2','P3'],
  beauty:             ['AE1','AE2','AE3'],
  transformation:     ['TR1','TR2','TR3'],
  curiosity:          ['K1','K2','K3'],
  physicality:        ['PH1','PH2','PH3','PH4'],
  shadow:             ['SH1','SH2','SH3','SH4'],
  mortality:          ['MO1','MO2','MO3'],
  legacy:             ['L1','L2','L3'],
  ecological_role:    ['EC1','EC2','EC3'],
  camouflage_display: ['CD1','CD2','CD3'],
  social_legibility:  ['SL1','SL2','SL3'],
  spirituality:       ['SP1','SP2','SP3'],
  nurturing:          ['NU1','NU2','NU3'],
};

function scoreAnswers(answers) {
  const dimScores = {};

  for (const [dim, questions] of Object.entries(DIM_QUESTIONS)) {
    const scores = [];

    for (const qid of questions) {
      const answer = answers[qid];
      if (answer === undefined || answer === null) continue;

      const map = SCORE_MAP[qid];
      if (!map) continue;

      let score;

      if (map === 'slider') {
        score = sliderToScore(answer);
      } else if (map === 'image') {
        const imgMap = IMAGE_SCORES[qid];
        if (imgMap && imgMap[answer] !== undefined) {
          score = imgMap[answer];
        }
      } else if (Array.isArray(map)) {
        score = map[answer];
      }

      if (score !== undefined && !isNaN(score)) {
        scores.push(score);
      }
    }

    if (scores.length > 0) {
      dimScores[dim] = scores.reduce((a, b) => a + b, 0) / scores.length;
    } else {
      dimScores[dim] = 0;
    }
  }

  return dimScores;
}

function buildMatchVector(dimScores) {
  // Returns a vector of just the dimensions we have in the database
  // Maps our dimension names to DB column names
  const dbColToDim = {
    'cognitive_style': 'cognitive_style',
    'emotional_regulation': 'emotional_regulation',
    'attachment_style': 'attachment_style',
    'social_architecture': 'social_architecture',
    'aspiration_drive': 'aspiration',
    'creativity_play': 'creativity',
    'transformation': 'transformation',
    'curiosity': 'curiosity',
    'physicality': 'physicality',
    'camouflage_display': 'camouflage_display',
    'social_legibility': 'social_legibility',
    'nurturing': 'nurturing',
  };

  const vector = {};
  for (const [dbCol, dim] of Object.entries(dbColToDim)) {
    vector[dbCol] = dimScores[dim] ?? 0;
  }
  return vector;
}

function cosineSimilarity(vecA, vecB, columns) {
  let dot = 0, magA = 0, magB = 0;
  for (const col of columns) {
    const a = vecA[col] ?? 0;
    const b = vecB[col] ?? 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = {
  scoreAnswers,
  buildMatchVector,
  cosineSimilarity,
  MATCH_COLUMNS,
  DIM_QUESTIONS,
};
