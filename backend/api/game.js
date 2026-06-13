export default function handler(req, res) {
    // Setting up the time window (15s matches frontend duration logic before starting next rounds)
    const ROUND_DURATION = 15000;
    
    // Seed generating deterministic logic based on strict timestamp windows
    const currentWindowStart = Math.floor(Date.now() / ROUND_DURATION);
    const x = Math.sin(currentWindowStart) * 10000;
    const r = x - Math.floor(x);
    
    let crashPoint = 1.05;
    if (r < 0.1) crashPoint = 1.05;
    else if (r < 0.5) crashPoint = 1.2 + (r * 2);
    else if (r < 0.8) crashPoint = 3.0 + (r * 8);
    else crashPoint = 15.0 + (r * 50);

    // Hardcap logic if necessary, or just standard formatting
    crashPoint = parseFloat(crashPoint.toFixed(2));

    res.status(200).json({ 
        crashPoint, 
        roundSignature: currentWindowStart 
    });
}
