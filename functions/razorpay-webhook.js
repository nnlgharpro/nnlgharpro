export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const signature = request.headers.get('x-razorpay-signature');
        const bodyText = await request.text();

        if (!signature) {
            return new Response(JSON.stringify({ error: 'No signature' }), {
                status: 400, headers: { 'Content-Type': 'application/json' }
            });
        }

        const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET || '').replace(/[\s\r\n\t]/g, '');
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(webhookSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
        const expectedSig = [...new Uint8Array(sigBuffer)]
            .map(b => b.toString(16).padStart(2, '0')).join('');

        if (expectedSig !== signature) {
            return new Response(JSON.stringify({ error: 'Invalid signature' }), {
                status: 400, headers: { 'Content-Type': 'application/json' }
            });
        }

        const eventData = JSON.parse(bodyText);
        const eventType = eventData.event || '';

        if (eventType === 'payment.captured') {
            const payment = eventData.payload.payment.entity;
            const notes = payment.notes || {};
            const bookingId = notes.bookingId || '';

            if (bookingId) {
                const projectId = env.FIREBASE_PROJECT_ID || 'gharproindia';
                const fsUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/bookings/${bookingId}?updateMask.fieldPaths=paymentStatus&updateMask.fieldPaths=paymentConfirmed&updateMask.fieldPaths=transactionId&updateMask.fieldPaths=status&updateMask.fieldPaths=paidAt`;

                await fetch(fsUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: {
                            paymentStatus: { stringValue: 'paid' },
                            paymentConfirmed: { booleanValue: true },
                            transactionId: { stringValue: payment.id },
                            status: { stringValue: 'assigned' },
                            paidAt: { stringValue: new Date().toISOString() }
                        }
                    })
                });
            }
        }

        return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function onRequestGet() {
    return new Response(JSON.stringify({
        status: 'ok',
        message: 'Razorpay Webhook running'
    }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
    });
}
