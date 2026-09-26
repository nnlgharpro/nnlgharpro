// ═══════════════════════════════════════════════════════════
// NnlGharPro — Razorpay Webhook Handler (Cloudflare Workers)
// ═══════════════════════════════════════════════════════════

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const signature = request.headers.get('x-razorpay-signature');
        const bodyText = await request.text();

        if (!signature) {
            return new Response(JSON.stringify({ error: 'No signature' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET || 'nnlgharpro@123456';
        const isValid = await verifySignature(bodyText, signature, webhookSecret);

        if (!isValid) {
            console.error('❌ Invalid signature');
            return new Response(JSON.stringify({ error: 'Invalid signature' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const eventData = JSON.parse(bodyText);
        const eventType = eventData.event || '';
        console.log('✅ Webhook received:', eventType);

        if (eventType === 'payment.captured') {
            const payment = eventData.payload.payment.entity;
            const notes = payment.notes || {};
            const bookingId = notes.bookingId || '';
            console.log('💰 Payment captured:', payment.id, '| Booking:', bookingId);

            if (bookingId) {
                await updateFirestore(bookingId, {
                    paymentStatus: 'paid',
                    paymentConfirmed: true,
                    transactionId: payment.id,
                    status: 'assigned',
                    paidAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    webhookVerified: true
                }, env);
            }
        }

        if (eventType === 'payment.failed') {
            const payment = eventData.payload.payment.entity;
            const notes = payment.notes || {};
            const bookingId = notes.bookingId || '';
            console.log('❌ Payment failed:', payment.id, '| Booking:', bookingId);

            if (bookingId) {
                await updateFirestore(bookingId, {
                    paymentStatus: 'failed',
                    paymentConfirmed: false,
                    updatedAt: new Date().toISOString()
                }, env);
            }
        }

        return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('❌ Webhook error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function verifySignature(body, signature, secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expectedSig = [...new Uint8Array(sigBuffer)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return signature === expectedSig;
}

async function updateFirestore(bookingId, data, env) {
    const projectId = env.FIREBASE_PROJECT_ID || 'gharproindia';
    const fieldPaths = Object.keys(data).map(k => `updateMask.fieldPaths=${k}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/bookings/${bookingId}?${fieldPaths}`;

    const fields = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            fields[key] = { stringValue: value };
        } else if (typeof value === 'boolean') {
            fields[key] = { booleanValue: value };
        } else if (typeof value === 'number') {
            fields[key] = { integerValue: value.toString() };
        }
    }

    const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('❌ Firestore update failed:', err);
        throw new Error('Firestore update failed');
    }
    console.log('✅ Firestore updated:', bookingId);
}

export async function onRequestGet(context) {
    return new Response(JSON.stringify({
        status: 'ok',
        message: 'Razorpay Webhook is running',
        info: 'POST requests only for webhook events'
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}
