// ZOETYPE EMAIL CHECKOUT LOOKUP
// GET /api/checkout-email?email=xxx
// Looks up saved session by email, creates Stripe checkout, redirects

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { email } = req.query;

  if (!email) {
    return res.redirect('/');
  }

  try {
    // Find their most recent session by email
    const { data: session } = await supabase
      .from('zoetype_sessions')
      .select('*')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      // No session found — send them to take the quiz
      return res.redirect('/quiz');
    }

    // Create a fresh Stripe checkout with their saved data
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      metadata: {
        firstName: session.first_name || '',
        animalName: session.animal_name || '',
        scientificName: session.scientific_name || '',
        email: email,
        existing_session_id: session.id,
      },
      success_url: `https://zoetype.vercel.app/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://zoetype.vercel.app/result`,
    });

    // Update the session with the new Stripe session ID
    await supabase
      .from('zoetype_sessions')
      .update({ stripe_session_id: stripeSession.id })
      .eq('id', session.id);

    return res.redirect(stripeSession.url);

  } catch (err) {
    console.error('Email checkout error:', err);
    return res.redirect('/quiz');
  }
};
