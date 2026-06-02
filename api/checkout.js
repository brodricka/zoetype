// ZOETYPE STRIPE CHECKOUT
// Vercel serverless function — POST /api/checkout
// Body: { email, firstName, animalName, scientificName }
// Returns: { url } — Stripe checkout session URL

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, firstName, animalName, scientificName } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      metadata: {
        firstName: firstName || '',
        animalName: animalName || '',
        scientificName: scientificName || '',
        email: email || '',
      },
      success_url: `https://zoetype.vercel.app/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://zoetype.vercel.app/result`,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: 'Checkout failed' });
  }
};
