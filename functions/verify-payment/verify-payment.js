// ═══════════════════════════════════════════════════════════
// NnlGharPro — Razorpay Payment Verification
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
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return new Response(JSON.stringify({ success: false, error: 'Missing params' }), {
                status: 400, headers: corsHeaders
            });
        }

        const keySecret = env.RAZORPAY_KEY_SECRET;
        if (!keySecret) {
            return new Response(JSON.stringify({ success: false, error: 'Key secret not configured' }), {
                status: 500, headers: corsHeaders
            });
        }

        const bodyStr = `${razorpay_order_id}|${razorpay_payment_id}`;
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw', encoder.encode(keySecret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyStr));
        const expectedSig = [...new Uint8Array(sigBuffer)]
            .map(b => b.toString(16).padStart(2, '0')).join('');

        if (expectedSig !== razorpay_signature) {
            return new Response(JSON.stringify({ success: false, error: 'Invalid signature' }), {
                status: 400, headers: corsHeaders
            });
        }

        return new Response(JSON.stringify({
            success: true,
            message: 'Payment verified',
            payment_id: razorpay_payment_id,
            order_id: razorpay_order_id
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
        message: 'Verify Payment API is running'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
