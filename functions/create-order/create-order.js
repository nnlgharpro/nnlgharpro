// ═══════════════════════════════════════════════════════════
// NnlGharPro — Razorpay Create Order (Cloudflare Pages Function)
// ═══════════════════════════════════════════════════════════

export async function onRequestPost(context) {
    const { request, env } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    try {
        const body = await request.json();
        const { amount, purpose, bookingId, providerId } = body;

        if (!amount || amount < 1) {
            return new Response(JSON.stringify({ success: false, error: 'Invalid amount' }), {
                status: 400, headers: corsHeaders
            });
        }

        const keyId = env.RAZORPAY_KEY_ID;
        const keySecret = env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) {
            return new Response(JSON.stringify({ success: false, error: 'Keys not configured' }), {
                status: 500, headers: corsHeaders
            });
        }

        const auth = btoa(`${keyId}:${keySecret}`);

        const notes = { purpose: purpose || 'payment' };
        if (bookingId) notes.bookingId = bookingId;
        if (providerId) notes.providerId = providerId;

        const response = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: Math.round(amount * 100),
                currency: 'INR',
                receipt: `rcpt_${Date.now()}`,
                notes: notes
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return new Response(JSON.stringify({
                success: false,
                error: data.error?.description || 'Razorpay order creation failed'
            }), { status: response.status, headers: corsHeaders });
        }

        return new Response(JSON.stringify({
            success: true,
            order_id: data.id,
            amount: data.amount,
            currency: data.currency
        }), { status: 200, headers: corsHeaders });

    } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500, headers: corsHeaders
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
    });
}

export async function onRequestGet() {
    return new Response(JSON.stringify({
        status: 'ok',
        message: 'Create Order API is running. POST to create an order.'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
