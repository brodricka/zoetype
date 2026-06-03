// ZOETYPE STRIPE WEBHOOK
// POST /api/webhook
// Handles payment.succeeded — generates PDF report and emails it

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      // Get saved session data from Supabase
      const { data: savedSession, error } = await supabase
        .from('zoetype_sessions')
        .select('*')
        .eq('stripe_session_id', session.id)
        .single();

      if (error || !savedSession) {
        console.error('Session not found:', session.id);
        return res.status(200).json({ received: true });
      }

      if (savedSession.report_sent) {
        return res.status(200).json({ received: true });
      }

      // Generate the full report
      const report = await generateFullReport(savedSession);

      // Send the report email
      await sendReportEmail(savedSession, report);

      // Mark as sent
      await supabase
        .from('zoetype_sessions')
        .update({ report_sent: true })
        .eq('stripe_session_id', session.id);

    } catch (err) {
      console.error('Report generation error:', err);
    }
  }

  return res.status(200).json({ received: true });
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function generateFullReport(session) {
  const firstName = session.first_name || 'there';
  const animalName = session.animal_name || 'your animal';
  const scientificName = session.scientific_name || '';
  const portrait = session.portrait || {};
  const shadow = session.shadow || '';

  const prompt = `You are writing the full Zoëtype Report for ${firstName}, who has been matched to the ${animalName} (${scientificName}).

Their free result included this portrait:
${(portrait.paragraphs || []).join('\n\n')}

Shadow trait: ${shadow}

WRITE THE FULL 15-PAGE ZOETYPE REPORT. This is a paid product. It must be genuinely valuable, specific, and written with the animal as the lens throughout every section. Every insight connects back to how the ${animalName} actually lives.

ABSOLUTE WRITING RULES:
- No em dashes. Use periods or commas.
- No "not X — Y" constructions.
- No "you likely," "you may," "perhaps," "it seems."
- No vague profundity. Every sentence lands something specific.
- Write like a sharp, compassionate observer who knows this animal deeply and sees this person clearly.
- Short sentences hit harder than long ones.
- Write entirely in second person. "You" is the default throughout.
- Use ${firstName}'s name sparingly — two or three times across the whole report — as a direct address only. "Brandon, you carry something of this." Never as a third-person subject. Never "Brandon does" or "Brandon is" or "Brandon feels." Always "you do" or "you are" or "you feel." The name punctuates; it does not narrate.

STRUCTURE — write all 8 sections in full:

1. HOW YOU LOVE (400 words)
How the ${animalName}'s bonding behavior, mating patterns, and attachment style map to how ${firstName} forms and maintains intimate relationships. What they need from a partner. What they give. What they withhold without meaning to. What their version of commitment looks like.

2. HOW YOU WORK (400 words)
How the ${animalName}'s hunting strategy, daily rhythm, and survival approach maps to how ${firstName} works. Their natural work style. Where they thrive. What environments drain them. How they handle collaboration vs solitude. What they need to do their best work.

3. YOUR SHADOW, FULLY EXPLORED (500 words)
A deep exploration of the shadow trait. What it costs them in relationships. What it costs them in work. Where it comes from biologically in the ${animalName}. How to work with it rather than against it. What it looks like when it runs unchecked.

4. CAREER RESONANCE (400 words)
The kinds of work, roles, and environments that are genuinely well-suited to someone with this animal's profile. Specific domains, not job titles. What they should avoid and why. What they underestimate about themselves professionally.

5. COMPATIBILITY (400 words)
What kinds of people this animal type bonds well with. What creates friction. What they need in a partner or close collaborator that they may not be asking for directly. What they offer that others rarely find elsewhere.

6. WHAT RESTORES YOU (300 words)
Specific conditions, environments, and experiences that genuinely restore this person based on the ${animalName}'s behavioral ecology. What fills them back up. How long they need. What happens if they don't get it.

7. WHAT DEPLETES YOU (300 words)
Specific conditions and dynamics that drain this person faster than they realize. What they tolerate that they shouldn't. What looks fine on the outside but costs them something real.

8. CLOSING REFLECTION (300 words)
A final section addressed directly to ${firstName}. What the ${animalName} knows that ${firstName} is still learning. What this match means at a deeper level. End on something true and specific that they will want to return to.

Write all 8 sections in full now. Do not summarize or abbreviate. This is a paid product and must deliver genuine value.

Respond in this JSON format with no markdown or backticks:
{
  "sections": [
    {"title": "How You Love", "content": "..."},
    {"title": "How You Work", "content": "..."},
    {"title": "Your Shadow, Fully Explored", "content": "..."},
    {"title": "Career Resonance", "content": "..."},
    {"title": "Compatibility", "content": "..."},
    {"title": "What Restores You", "content": "..."},
    {"title": "What Depletes You", "content": "..."},
    {"title": "Closing Reflection", "content": "..."}
  ]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  
  try {
    return JSON.parse(clean);
  } catch(e) {
    console.error('Report parse error:', e);
    return { sections: [] };
  }
}

async function sendReportEmail(session, report) {
  const firstName = session.first_name || 'there';
  const animalName = session.animal_name || 'your animal';
  const scientificName = session.scientific_name || '';
  const photoUrl = session.photo_url;

  const photoHtml = photoUrl
    ? `<img src="${photoUrl}" alt="${animalName}" style="width:100%;max-height:360px;object-fit:cover;display:block;margin-bottom:40px;">`
    : '';

  const sectionsHtml = (report.sections || []).map(section => `
    <tr><td style="padding:0 0 12px 0;">
      <p style="margin:0;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#00e8ff;font-family:'Helvetica Neue',sans-serif;">${section.title}</p>
    </td></tr>
    <tr><td style="padding:0 0 40px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <p style="margin:0;font-family:'Georgia',serif;font-size:16px;font-weight:300;line-height:1.9;color:#8896b0;white-space:pre-wrap;">${section.content}</p>
    </td></tr>
    <tr><td style="padding:16px 0;"></td></tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#03070e;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#03070e;">
  <tr><td align="center" style="padding:40px 20px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <tr><td style="padding:0 0 32px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
        <p style="margin:0;font-family:'Georgia',serif;font-size:18px;color:#e2e8f5;letter-spacing:0.06em;">Zoë<em style="color:#00e8ff;">type</em></p>
      </td></tr>

      <tr><td style="padding:40px 0 8px 0;">
        <p style="margin:0;font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#4a5570;font-family:'Helvetica Neue',sans-serif;">Your full Zoëtype Report</p>
      </td></tr>

      <tr><td style="padding:0 0 4px 0;">
        <h1 style="margin:0;font-family:'Georgia',serif;font-size:48px;font-weight:300;color:#e2e8f5;line-height:1;">${animalName}</h1>
      </td></tr>

      <tr><td style="padding:0 0 8px 0;">
        <p style="margin:0;font-size:13px;font-style:italic;color:#4a5570;font-family:'Georgia',serif;">${scientificName}</p>
      </td></tr>

      <tr><td style="padding:0 0 40px 0;">
        <p style="margin:0;font-size:13px;color:#4a5570;font-family:'Helvetica Neue',sans-serif;">A report written for ${firstName} alone.</p>
      </td></tr>

      <tr><td>${photoHtml}</td></tr>

      ${sectionsHtml}

      <tr><td style="padding:40px;background:rgba(167,139,250,0.06);border:1px solid rgba(167,139,250,0.15);text-align:center;margin-top:20px;">
        <p style="margin:0 0 16px 0;font-family:'Georgia',serif;font-size:20px;font-weight:300;color:#e2e8f5;">Thank you for going deeper.</p>
        <p style="margin:0;font-size:14px;line-height:1.8;color:#8896b0;font-family:'Helvetica Neue',sans-serif;">If anything in this report resonates, or if you have questions about your result, reply to this email. We read every one.</p>
      </td></tr>

      <tr><td style="padding:32px 0;border-top:1px solid rgba(255,255,255,0.07);margin-top:40px;">
        <p style="margin:0;font-size:12px;color:#4a5570;font-family:'Helvetica Neue',sans-serif;">Zoëtype &nbsp;·&nbsp; Built on science, not archetypes &nbsp;·&nbsp; <a href="https://zoetype.app" style="color:#4a5570;">zoetype.app</a></p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  await resend.emails.send({
    from: 'Zoëtype <hello@zoetype.app>',
    to: session.email,
    subject: `Your full Zoëtype Report: ${animalName}`,
    html,
  });
}
