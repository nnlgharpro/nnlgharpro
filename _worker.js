export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
            'Content-Type': 'application/json'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // ═══════════════════════════════════════════════════════════
        // 🔍 DEBUG ENDPOINT
        // ═══════════════════════════════════════════════════════════
        if (path === '/debug-keys') {
            const rawKeyId = env.RAZORPAY_KEY_ID || '';
            const rawKeySecret = env.RAZORPAY_KEY_SECRET || '';
            const cleanKeyId = rawKeyId.replace(/[\s\r\n\t]/g, '');
            const cleanKeySecret = rawKeySecret.replace(/[\s\r\n\t]/g, '');
            return new Response(JSON.stringify({
                raw: {
                    keyIdLength: rawKeyId.length,
                    keyIdPrefix: rawKeyId.substring(0, 15),
                    keyIdHasSpace: rawKeyId !== rawKeyId.trim()
                },
                cleaned: {
                    keyIdLength: cleanKeyId.length,
                    keyIdPrefix: cleanKeyId.substring(0, 12)
                },
                secret: {
                    keySecretLength: rawKeySecret.length,
                    keySecretHasSpace: rawKeySecret !== rawKeySecret.trim()
                }
            }, null, 2), { status: 200, headers: corsHeaders });
        }

        // ═══════════════════════════════════════════════════════════
        // ✅ /create-order
        // ═══════════════════════════════════════════════════════════
        if (path === '/create-order' && request.method === 'POST') {
            try {
                const body = await request.json();
                const { amount, purpose, bookingId, providerId } = body;

                if (!amount || amount < 1) {
                    return new Response(JSON.stringify({ success: false, error: 'Invalid amount' }), {
                        status: 400, headers: corsHeaders
                    });
                }

                // ✅ EXTRA CLEAN — newline, tab, space sab hatao
                const keyId = (env.RAZORPAY_KEY_ID || '').replace(/[\s\r\n\t]/g, '');
                const keySecret = (env.RAZORPAY_KEY_SECRET || '').replace(/[\s\r\n\t]/g, '');

                if (!keyId || !keySecret) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Keys not configured',
                        hasKeyId: !!keyId,
                        hasKeySecret: !!keySecret
                    }), { status: 500, headers: corsHeaders });
                }

                const auth = btoa(`${keyId}:${keySecret}`);
                const notes = { purpose: purpose || 'payment' };
                if (bookingId) notes.bookingId = bookingId;
                if (providerId) notes.providerId = providerId;

                const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
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

                const data = await rzpRes.json();

                if (!rzpRes.ok) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: data.error?.description || 'Razorpay error',
                        razorpayStatus: rzpRes.status,
                        razorpayCode: data.error?.code || 'unknown'
                    }), { status: rzpRes.status, headers: corsHeaders });
                }

                return new Response(JSON.stringify({
                    success: true,
                    order_id: data.id,
                    amount: data.amount
                }), { status: 200, headers: corsHeaders });

            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: error.message }), {
                    status: 500, headers: corsHeaders
                });
            }
        }

        // ═══════════════════════════════════════════════════════════
        // ✅ /verify-payment
        // ═══════════════════════════════════════════════════════════
        if (path === '/verify-payment' && request.method === 'POST') {
            try {
                const body = await request.json();
                const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

                const keySecret = (env.RAZORPAY_KEY_SECRET || '').replace(/[\s\r\n\t]/g, '');
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

                return new Response(JSON.stringify({ success: true, message: 'Verified' }), {
                    status: 200, headers: corsHeaders
                });

            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: error.message }), {
                    status: 500, headers: corsHeaders
                });
            }
        }

        // ═══════════════════════════════════════════════════════════
        // ✅ /razorpay-webhook
        // ═══════════════════════════════════════════════════════════
        if (path === '/razorpay-webhook' && request.method === 'POST') {
            try {
                const signature = request.headers.get('x-razorpay-signature');
                const bodyText = await request.text();

                if (!signature) {
                    return new Response(JSON.stringify({ error: 'No signature' }), {
                        status: 400, headers: corsHeaders
                    });
                }

                const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET || '').replace(/[\s\r\n\t]/g, '');
                const encoder = new TextEncoder();
                const key = await crypto.subtle.importKey(
                    'raw', encoder.encode(webhookSecret),
                    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
                );
                const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
                const expectedSig = [...new Uint8Array(sigBuffer)]
                    .map(b => b.toString(16).padStart(2, '0')).join('');

                if (expectedSig !== signature) {
                    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
                        status: 400, headers: corsHeaders
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
                    status: 200, headers: corsHeaders
                });

            } catch (error) {
                return new Response(JSON.stringify({ error: error.message }), {
                    status: 500, headers: corsHeaders
                });
            }
        }

        // ═══════════════════════════════════════════════════════════
        // ✅ /api-test
        // ═══════════════════════════════════════════════════════════
        if (path === '/api-test') {
            return new Response(JSON.stringify({
                status: 'ok',
                message: 'NnlGharPro API running',
                endpoints: ['/create-order', '/verify-payment', '/razorpay-webhook', '/debug-keys']
            }), { status: 200, headers: corsHeaders });
        }

        // ═══════════════════════════════════════════════════════════
        // ✅ Static files
        // ═══════════════════════════════════════════════════════════
        return env.ASSETS.fetch(request);
    }
};
