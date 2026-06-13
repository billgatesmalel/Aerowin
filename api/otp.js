/**
 * backend/api/otp.js
 * 
 * Secure OTP Generator & Verifier
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    const { action, phone, code } = req.body;

    if (action === 'send') {
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60000).toISOString(); // 10 mins

        // Store in DB
        const { error } = await supabase.from('otps').insert({
            phone,
            code: otpCode,
            expires_at: expiresAt
        });

        if (error) return res.status(500).json({ error: error.message });

        // Trigger Email via Brevo (Backend call)
        // For production, we'd map phone to user's email
        // For now, we'll return the code in dev mode or mock the send
        console.log(`[OTP] Code for ${phone}: ${otpCode}`);
        
        return res.status(200).json({ success: true, message: "Code sent (check logs in dev)" });
    }

    if (action === 'verify') {
        const { data: otp, error } = await supabase
            .from('otps')
            .select('*')
            .eq('phone', phone)
            .eq('code', code)
            .eq('verified', false)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error || !otp) return res.status(400).json({ error: "Invalid or expired code" });

        // Mark as verified
        await supabase.from('otps').update({ verified: true }).eq('id', otp.id);

        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
}
