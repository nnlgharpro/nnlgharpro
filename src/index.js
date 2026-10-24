export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, ''); 
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gateway-Authorization',
    };
    
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    
    try {
      // --- FRONTEND OUTGOING ---
      if (path.startsWith('client_')) {
        const action = path.replace('client_', '');
        const reqBody = await request.json();
        const transactionId = reqBody.transactionId || crypto.randomUUID();
        
        // Yahan hum payload build kar rahe hain (Bina Signature ke testing ke liye)
        const payload = {
          context: {
            domain: "ONDC:RET11",
            country: "IND",
            city: "std:011",
            action: action,
            core_version: "1.2.5",
            bap_id: env.ONDC_BAP_ID,
            bap_uri: env.ONDC_BAP_URI,
            bpp_id: "workbench.ondc.tech",         // ✅ FIXED
            bpp_uri: "https://workbench.ondc.tech", // ✅ FIXED
            transaction_id: transactionId,
            message_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            ttl: "PT30S"
          },
          message: {}
        };

        if (action === 'search') {
            payload.message = {
                intent: {
                    item: { descriptor: { name: "Food" } },
                    fulfillment: { type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: reqBody.pincode || "110001" } } } }
                }
            };
        } else if (action === 'select' || action === 'init' || action === 'confirm') {
            payload.message = {
                order: {
                    provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
                    items: [{ 
                        id: "item_veg_thali", 
                        quantity: { count: 1 },
                        location_id: "L1", // ✅ FIXED
                        tags: [{ code: "type", list: [{ code: "type", value: "item" }] }] // ✅ FIXED
                    }],
                    billing: {
                        name: "Test User",
                        address: { name: "Test User", building: "Main Road", locality: "Test Locality", city: "Delhi", state: "Delhi", country: "IND", area_code: reqBody.pincode || "110001" },
                        phone: "9876543210", email: "test@nnlgharpro.com"
                    },
                    fulfillments: [{
                        id: "F1", type: "Delivery",
                        end: {
                            location: { gps: "28.6139,77.2090", address: { name: "Test User", building: "Main Road", locality: "Test Locality", city: "Delhi", state: "Delhi", country: "IND", area_code: reqBody.pincode || "110001" } },
                            contact: { phone: "9876543210", email: "test@nnlgharpro.com" }
                        }
                    }]
                }
            };
            if (action === 'confirm') {
                payload.message.order.state = "Created";
                payload.message.order.payment = { uri: "https://razorpay.com", tls_method: "string", status: "PAID", type: "ON-ORDER", collected_by: "BAP" };
            }
        }

        // Gateway ko request bhejein
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;
        ctx.waitUntil(
          fetch(gatewayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).then(async (res) => {
            console.log(`[${action.toUpperCase()}] Status: ${res.status} | Response: ${await res.text()}`);
          }).catch(e => console.log(e))
        );

        // Frontend ko response
        return new Response(JSON.stringify({ 
            success: true, 
            transactionId: transactionId 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
  }
};
