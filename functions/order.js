export async function onRequestPost(context) {
    const { request, env } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    try {
        const { amount, purpose, bookingId, providerId } = await request.json();

        if (!amount || amount < 1) {
            return new Response(JSON.stringify({ error: 'Invalid amount' }), {
                status: 400, headers: corsHeaders
            });
        }

        const keyId = env.RAZORPAY_KEY_ID;
        const keySecret = env.RAZORPAY_KEY_SECRET;

        const auth = btoa(`${keyId}:${keySecret}`);

        const notes = { purpose: purpose || 'payment' };
        if (bookingId) notes.bookingId = bookingId;
        if (providerId) notes.providerId = providerId;

        const res = await fetch('https://api.razorpay.com/v1/orders', {
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

        const data = await res.json();

        if (!res.ok) {
            return new Response(JSON.stringify({ error: data.error?.description }), {
                status: res.status, headers: corsHeaders
            });
        }

        return new Response(JSON.stringify({
            success: true,
            order_id: data.id
        }), { status: 200, headers: corsHeaders });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
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
