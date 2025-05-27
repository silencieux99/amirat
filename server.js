require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

// Route pour créer une session de paiement
app.post('/create-checkout-session', async (req, res) => {
  console.log("Requête reçue sur /create-checkout-session avec le corps:", req.body);
  try {
    const { token, amount, currency, reference, tiktok, customer, shipping } = req.body;

    // Valider que les données nécessaires sont présentes
    if (!token || !amount || !currency || !customer || !customer.email || !shipping || !shipping.address) {
      console.error("Validation échouée: Données de paiement manquantes ou invalides", req.body);
      return res.status(400).json({ success: false, error: "Données de paiement manquantes ou invalides." });
    }
    
    console.log("Validation des données d'entrée réussie. Tentative de création du PaymentIntent...");

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, // Montant en centimes, déjà calculé par le frontend
      currency: currency,
      payment_method_data: {
        type: 'card',
        card: {
          token: token // L'ID du token reçu du frontend
        }
      },
      confirm: true, // Tente de confirmer le paiement immédiatement
      description: `Commande Amirat Modestie - ${reference || 'N/A'}`,
      receipt_email: customer.email,
      shipping: {
        name: customer.name || `${shipping.address.city || 'N/A'}`, // Assurer un nom pour la livraison
        address: {
          line1: shipping.address.line1,
          postal_code: shipping.address.postal_code,
          city: shipping.address.city,
          country: shipping.address.country
        },
        phone: customer.phone || undefined // Optionnel
      },
      metadata: {
        reference: reference || 'N/A',
        tiktok: tiktok || 'N/A'
      },
      // Gère automatiquement la confirmation et les étapes 3DS si possible avec confirm:true
      // Si une action est requise, le statut sera 'requires_action'
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never' // Important pour les intégrations API directes
      },
    });

    if (paymentIntent.status === 'succeeded') {
      res.json({
        success: true,
        transactionId: paymentIntent.id // L'ID du PaymentIntent
      });
    } else if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_payment_method') {
      // Ce cas signifie qu'une authentification supplémentaire (comme 3D Secure) est requise
      // ou que la méthode de paiement a été refusée.
      // Votre frontend actuel (index.html) n'est pas configuré pour gérer stripe.confirmCardPayment()
      // qui serait nécessaire ici avec le paymentIntent.client_secret.
      // Pour l'instant, nous traitons cela comme un échec, mais avec plus de détails.
      let specificError = 'Une action supplémentaire est requise par votre banque ou la méthode de paiement a été refusée.';
      if (paymentIntent.last_payment_error && paymentIntent.last_payment_error.message) {
        specificError = paymentIntent.last_payment_error.message;
      }
      res.status(400).json({
        success: false,
        error: specificError, // Assure qu'il y a toujours un message
        requires_action: paymentIntent.status === 'requires_action', 
        client_secret: paymentIntent.client_secret // Le client_secret serait utilisé par stripe.confirmCardPayment()
      });
    } else {
      // Gérer les autres échecs
      res.status(400).json({ success: false, error: 'Le paiement a échoué. Statut: ' + paymentIntent.status });
    }

  } catch (error) {
    console.error('Erreur Stripe Backend (bloc catch principal):', error);
    let errorMessage = "Une erreur est survenue lors du traitement du paiement.";
    if (error.type === 'StripeCardError') {
      errorMessage = error.message; // Message d'erreur de Stripe plus spécifique
    } else if (error.type === 'StripeInvalidRequestError') {
      errorMessage = "Une erreur de configuration est survenue avec la requête de paiement.";
    }
    res.status(500).json({ success: false, error: errorMessage, stripeErrorType: error.type });
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

// === ROUTE DE CONTACT ===

// Configurez votre transporteur SMTP ici (exemple avec Gmail, à adapter selon votre fournisseur)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // ex: 'smtp.gmail.com'
  port: process.env.SMTP_PORT || 465,
  secure: true, // true pour 465, false pour 587
  auth: {
    user: process.env.SMTP_USER, // votre email
    pass: process.env.SMTP_PASS  // votre mot de passe ou app password
  }
});

app.post('/api/contact', async (req, res) => {
  const { name, email, tiktok, reference, date, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Tous les champs obligatoires sont requis.' });
  }
  try {
    let infosOptionnelles = '';
    if (tiktok) infosOptionnelles += `Pseudo TikTok : ${tiktok}\n`;
    if (reference) infosOptionnelles += `Référence de commande : ${reference}\n`;
    if (date) infosOptionnelles += `Date de commande : ${date}\n`;
    await transporter.sendMail({
      from: `"Contact Amirat" <${process.env.SMTP_USER}>`,
      to: 'contact@amirat-modestie.fr',
      subject: `Nouveau message de contact de ${name}`,
      replyTo: email,
      text: `Nom: ${name}\nEmail: ${email}\n${infosOptionnelles}\nMessage:\n${message}`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Erreur envoi mail contact:', err);
    if (err && err.response) {
      console.error('Réponse SMTP:', err.response);
    }
    if (err && err.code) {
      console.error('Code erreur SMTP:', err.code);
    }
    res.status(500).json({ error: 'Erreur lors de l\'envoi du message.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
}); 