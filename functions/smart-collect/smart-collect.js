// ============================================================
// 🔥 SMART COLLECT FUNCTION - 100% DEPLOYABLE
// ============================================================
const Razorpay = require('razorpay');
const admin = require('firebase-admin');

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
    });
}

const db = admin.firestore();
const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: 'OK' };
    }

    try {
        const body = JSON.parse(event.body);
        const {
            providerId,
            providerName,
            providerEmail,
            providerMobile,
            ifscCode,
            bankAccount,
            accountHolder
        } = body;

        if (!providerId || !ifscCode || !bankAccount || !accountHolder) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ success: false, message: 'Missing required fields' })
            };
        }

        const customer = await razorpay.customers.create({
            name: providerName,
            email: providerEmail || 'no-email@example.com',
            contact: providerMobile || '0000000000'
        });

        const virtualAccount = await razorpay.virtualAccounts.create({
            receivers: {
                types: ['bank_account'],
                bank_account: {
                    ifsc: ifscCode,
                    account_number: bankAccount
                }
            },
            notes: {
                providerId: providerId,
                providerName: providerName
            },
            customer_id: customer.id
        });

        await db.collection('providers').doc(providerId).update({
            onboardStatus: 'active',
            virtualAccountId: virtualAccount.id,
            upiId: virtualAccount.upi_id || '',
            bankAccount: bankAccount,
            ifscCode: ifscCode,
            accountHolder: accountHolder,
            razorpayCustomerId: customer.id,
            updatedAt: new Date().toISOString()
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: '✅ Smart Collect Identifier created successfully!',
                virtualAccountId: virtualAccount.id,
                upiId: virtualAccount.upi_id || '',
                customerId: customer.id
            })
        };

    } catch (error) {
        console.error('❌ Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                message: error.message
            })
        };
    }
};
