const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Route pour créer une session de paiement
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount, reference, tiktok } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `Commande Amirat Modestie - ${reference}`,
              description: `Commande TikTok: ${tiktok}`,
            },
            unit_amount: Math.round(amount * 100), // Stripe utilise les centimes
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/cancel.html`,
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route pour vérifier le statut du paiement
app.get('/check-payment-status/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json({ status: session.payment_status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
}); 