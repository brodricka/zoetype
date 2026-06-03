// ZOETYPE STRIPE CHECKOUT
// POST /api/checkout
// Saves session data to Supabase, creates Stripe checkout session

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, firstName, animalName, scientificName, photoUrl, portrait, shadow, fun_fact, dimensions, answers } = req.body;

    // Create Stripe checkout session first to get session ID
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      metadata: {
        firstName: firstName || '',
        animalName: animalName || '',
        scientificName: scientificName || '',
        email: email || '',
      },
      success_url: `https://zoetype.app/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://zoetype.app/result`,
    });

    // Save full session data to Supabase keyed to Stripe session ID
    await supabase.from('zoetype_sessions').insert({
      stripe_session_id: session.id,
      email: email || null,
      first_name: firstName || null,
      animal_name: animalName || null,
      scientific_name: scientificName || null,
      photo_url: photoUrl || null,
      portrait: portrait || null,
      shadow: shadow || null,
      fun_fact: fun_fact || null,
      dimensions: dimensions || null,
      answers: answers || null,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Checkout failed' });
  }
};
