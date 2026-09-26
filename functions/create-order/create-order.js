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
        const { amount, purpose, bookingId, providerId, customerName, customerMobile } = body;

        // ✅ Validation
        if (!amount || amount < 1) {
            return new Response(JSON.stringify({ success: false, error: 'Invalid amount' }), {
                status: 400, headers: corsHeaders
            });
        }

        if (!purpose || !['customer_booking', 'provider_subscription'].includes(purpose)) {
            return new Response(JSON.stringify({ success: false, error: 'Invalid purpose' }), {
                status: 400, headers: corsHeaders
            });
        }

        // ✅ Razorpay credentials from env
        const keyId = env.RAZORPAY_KEY_ID;
        const keySecret = env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) {
            return new Response(JSON.stringify({ success: false, error: 'Razorpay keys not configured' }), {
                status: 500, headers: corsHeaders
            });
        }

        // ✅ Basic Auth header
        const auth = btoa(`${keyId}:${keySecret}`);

        // ✅ Notes (webhook ke liye zaroori)
        const notes = { purpose };
        if (bookingId) notes.bookingId = bookingId;
        if (providerId) notes.providerId = providerId;
        if (customerName) notes.customerName = customerName;
        if (customerMobile) notes.customerMobile = customerMobile;

        // ✅ Create order via Razorpay API
        const response = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: Math.round(amount * 100), // ₹ → paise
                currency: 'INR',
                receipt: `rcpt_${Date.now()}`,
                notes: notes
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Razorpay error:', data);
            return new Response(JSON.stringify({ 
                success: false, 
                error: data.error?.description || 'Razorpay order creation failed' 
            }), {
                status: response.status, headers: corsHeaders
            });
        }

        console.log('✅ Order created:', data.id, '| Purpose:', purpose);

        return new Response(JSON.stringify({
            success: true,
            order_id: data.id,
            amount: data.amount,
            currency: data.currency
        }), {
            status: 200, headers: corsHeaders
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500, headers: corsHeaders
        });
    }
}

// ✅ OPTIONS handler (CORS preflight)
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

// ✅ GET handler (testing)
export async function onRequestGet() {
    return new Response(JSON.stringify({
        status: 'ok',
        message: 'Create Order API is running. POST to create an order.'
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}
