/**
 * backend/api/send-email.js
 * 
 * Secure backend endpoint to send transactional emails via Brevo.
 * This keeps the API key hidden from the frontend.
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { to, subject, htmlContent } = req.body;
    const apiKey = process.env.BREVO_API_KEY;

    if (!apiKey) return res.status(500).json({ error: 'Brevo API key not configured' });

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: "Metricwin Support", email: "support@metricwin.app" },
                to: [{ email: to }],
                subject: subject,
                htmlContent: htmlContent
            })
        });

        const result = await response.json();
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
