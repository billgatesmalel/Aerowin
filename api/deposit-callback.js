// api/deposit-callback.js — Vercel Serverless Function
// Receives Safaricom M-Pesa payment confirmation and credits user balance in Supabase

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY  // Use service role key (server-side only!)
);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = req.body;
        const stk  = body?.Body?.stkCallback;

        if (!stk) return res.status(400).json({ error: 'Invalid callback' });

        const resultCode = stk.ResultCode;
        const checkoutId = stk.CheckoutRequestID;

        if (resultCode !== 0) {
            // Payment cancelled or failed — log it
            console.log(`Payment failed for checkout ${checkoutId}: ${stk.ResultDesc}`);
            return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // Extract metadata
        const items = stk.CallbackMetadata?.Item || [];
        const get   = (name) => items.find(i => i.Name === name)?.Value;

        const amount      = parseFloat(get('Amount'));
        const mpesaRef    = get('MpesaReceiptNumber');
        const phone       = String(get('PhoneNumber') || '');

        // Normalize phone to match our format in profiles (e.g. 2547XXXXXXXX → 07XXXXXXXX)
        let phoneNorm = phone.replace(/^254/, '0');

        // Find user by phone
        const { data: profile, error: profErr } = await supabase
            .from('profiles')
            .select('id, balance, free_bet_given')
            .eq('phone', phoneNorm)
            .single();

        if (profErr || !profile) {
            console.error('Profile not found for phone:', phoneNorm);
            return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
        }

        // Credit balance
        let newBal = (profile.balance || 0) + amount;
        let updates = { balance: newBal };

        // First deposit bonus
        if (!profile.free_bet_given) {
            newBal += 20;
            updates = { balance: newBal, free_bet_given: true };
        }

        await supabase.from('profiles').update(updates).eq('id', profile.id);

        // Log transaction
        await supabase.from('transactions').insert({
            user_id:    profile.id,
            type:       'deposit',
            amount:     amount,
            status:     'completed',
            phone:      phoneNorm,
            reference:  mpesaRef
        });

        console.log(`✅ Credited KES ${amount} to ${phoneNorm} (mpesa: ${mpesaRef})`);
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    } catch (err) {
        console.error('Callback error:', err);
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' }); // Always 200 to Safaricom
    }
}
