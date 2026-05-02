// api/deposit.js  — Vercel Serverless Function
// Securely proxies STK Push to Safaricom Daraja API

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { phone, amount, userId } = req.body;

    if (!phone || !amount || amount < 100) {
        return res.status(400).json({ success: false, message: 'Invalid phone or amount' });
    }

    // ── Credentials from Vercel Environment Variables ──────────
    const CONSUMER_KEY    = process.env.DARAJA_CONSUMER_KEY;
    const CONSUMER_SECRET = process.env.DARAJA_CONSUMER_SECRET;
    const SHORTCODE       = process.env.DARAJA_SHORTCODE;       // Paybill / Till
    const PASSKEY         = process.env.DARAJA_PASSKEY;
    const CALLBACK_URL    = process.env.DARAJA_CALLBACK_URL;    // e.g. https://yourdomain.vercel.app/api/deposit-callback

    // ── 1. Get OAuth Token ────────────────────────────────────
    const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    const tokenRes = await fetch(
        'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        { headers: { Authorization: `Basic ${credentials}` } }
    );
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
        return res.status(500).json({ success: false, message: 'Auth failed with Safaricom' });
    }

    // ── 2. Build STK Push payload ─────────────────────────────
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password  = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

    // Normalize phone → 254XXXXXXXXX
    let normalizedPhone = String(phone).replace(/\D/g, '');
    if (normalizedPhone.startsWith('0'))  normalizedPhone = '254' + normalizedPhone.slice(1);
    if (normalizedPhone.startsWith('+'))  normalizedPhone = normalizedPhone.slice(1);

    const stkPayload = {
        BusinessShortCode: SHORTCODE,
        Password:          password,
        Timestamp:         timestamp,
        TransactionType:   'CustomerPayBillOnline',
        Amount:            Math.ceil(amount),
        PartyA:            normalizedPhone,
        PartyB:            SHORTCODE,
        PhoneNumber:       normalizedPhone,
        CallBackURL:       CALLBACK_URL,
        AccountReference:  `AEROWIN-${(userId || 'user').slice(0, 8)}`,
        TransactionDesc:   `Aerowin Deposit KES ${amount}`
    };

    // ── 3. Send STK Push ──────────────────────────────────────
    const stkRes = await fetch(
        'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        {
            method:  'POST',
            headers: {
                Authorization:  `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(stkPayload)
        }
    );

    const stkData = await stkRes.json();

    if (stkData.ResponseCode === '0') {
        return res.status(200).json({
            success:       true,
            checkoutId:    stkData.CheckoutRequestID,
            message:       'STK Push sent successfully'
        });
    } else {
        return res.status(400).json({
            success: false,
            message: stkData.errorMessage || stkData.CustomerMessage || 'STK Push failed'
        });
    }
}
