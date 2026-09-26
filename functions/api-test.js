export async function onRequestGet() {
    return new Response(JSON.stringify({
        status: 'ok',
        message: 'NnlGharPro API running',
        endpoints: ['/create-order', '/razorpay-webhook']
    }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
    });
}
