/**
 * api/otp.js — REMOVED
 *
 * OTP authentication has been completely removed from this platform.
 * Users authenticate using phone number + password only.
 *
 * This file is intentionally left as a 410 GONE stub so that any
 * stale client requests get a proper, informative response instead
 * of a generic 404, making debugging easier.
 */

export default function handler(req, res) {
    res.status(410).json({
        error: 'OTP authentication has been removed.',
        message: 'This platform uses phone number + password authentication only.',
    });
}
