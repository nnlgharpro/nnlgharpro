const crypto = require('crypto');

const WEBHOOK_SECRET = 'nnlgharpro@123456';

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Razorpay-Signature',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: 'OK' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const webhookSignature = event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'] || '';
        const webhookBody = event.body;

        const expectedSignature = crypto
            .createHmac('sha256', WEBHOOK_SECRET)
            .update(webhookBody)
            .digest('hex');

        if (webhookSignature !== expectedSignature) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
        }

        const eventData = JSON.parse(webhookBody);
        const eventType = eventData.event || '';

        if (eventType === 'payment.captured' || eventType === 'payment.authorized') {
            const paymentEntity = eventData.payload.payment.entity;
            const paymentId = paymentEntity.id;
            const notes = paymentEntity.notes || {};
            const bookingId = notes.bookingId || '';

            if (bookingId) {
                const projectId = 'gharproindia';
                const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/bookings/${bookingId}?updateMask.fieldPaths=paymentStatus&updateMask.fieldPaths=paymentConfirmed&updateMask.fieldPaths=transactionId&updateMask.fieldPaths=status&updateMask.fieldPaths=paidAt&updateMask.fieldPaths=updatedAt`;

                await fetch(firestoreUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: {
                            paymentStatus: { stringValue: 'paid' },
                            paymentConfirmed: { booleanValue: true },
                            transactionId: { stringValue: paymentId },
                            status: { stringValue: 'assigned' },
                            paidAt: { stringValue: new Date().toISOString() },
                            updatedAt: { stringValue: new Date().toISOString() }
                        }
                    })
                });
            }
        }

        if (eventType === 'payment.failed') {
            const paymentEntity = eventData.payload.payment.entity;
            const notes = paymentEntity.notes || {};
            const bookingId = notes.bookingId || '';

            if (bookingId) {
                const projectId = 'gharproindia';
                const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/bookings/${bookingId}?updateMask.fieldPaths=paymentStatus&updateMask.fieldPaths=paymentConfirmed&updateMask.fieldPaths=updatedAt`;

                await fetch(firestoreUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: {
                            paymentStatus: { stringValue: 'failed' },
                            paymentConfirmed: { booleanValue: false },
                            updatedAt: { stringValue: new Date().toISOString() }
                        }
                    })
                });
            }
        }

        return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
