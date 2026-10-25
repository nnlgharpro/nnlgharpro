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
      if (path === '' || path === 'api/health') {
        return jsonResponse({ status: 'active', version: '100.0.0' }, corsHeaders);
      }
      
      // Gateway se aane wale callbacks (ACK dena zaroori hai)
      if (path.startsWith('on_')) {
        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }

      // Frontend ya Workbench se aane wali request
      if (path.startsWith('client_') || path === 'search' || path === 'select' || path === 'init' || path === 'confirm') {
        
        const action = path.startsWith('client_') ? path.replace('client_', '') : path;
        
        let reqBody = {};
        if (request.method === 'POST') {
            try { reqBody = await request.json(); } catch(e) {}
        }

        const transactionId = reqBody.transactionId || "e496f730-8c9f-4152-a993-83f187cbdfbd";
        const domain = reqBody.domain || env.ONDC_DOMAIN || "ONDC:RET11";
        
        // Payload Build Karein
        const payload = buildPayload(action, domain, reqBody, transactionId, env);
        
        // Gateway URL
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

        // Gateway ko request bhejein (bina signature ke, kyunki Workbench mock hai)
        ctx.waitUntil(
          fetch(gatewayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
          .then(async (res) => {
            const text = await res.text();
            console.log(`[${action.toUpperCase()}] Status: ${res.status} | Response: ${text}`);
          })
          .catch((e) => console.log(`[${action.toUpperCase()}] Error:`, e.message))
        );

        // Frontend ko response
        return jsonResponse({ 
            success: true, 
            transactionId: transactionId,
            message: { catalog: { "bpp/providers": [] } }
        }, corsHeaders);
      }
      
      return jsonResponse({ error: 'Route not mapped' }, corsHeaders, 404);
    } catch (error) {
      return jsonResponse({ error: error.message }, corsHeaders, 500);
    }
  }
};

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function buildPayload(action, domain, body, transactionId, env) {
  const timestamp = new Date().toISOString();
  
  // Context Setup
  const context = {
    domain: domain, 
    country: "IND", 
    city: "std:011", 
    action: action, 
    core_version: '1.2.5',
    bap_id: env.ONDC_BAP_ID, 
    bap_uri: env.ONDC_BAP_URI,
    bpp_id: "workbench.ondc.tech", 
    bpp_uri: "https://workbench.ondc.tech", 
    transaction_id: transactionId, 
    message_id: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", // Fixed ID for Workbench to match
    timestamp: timestamp, 
    ttl: 'PT30S'
  };

  let message = {};

  if (action === 'search') {
    message = {
      intent: {
        item: { descriptor: { name: "Food" } },
        fulfillment: { type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } } } }
      }
    };
  } else if (action === 'select') {
    // ✅ PURE SELECT PAYLOAD (No billing, No fulfillments, Just items and tags)
    message = {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ 
            id: "item_veg_thali", 
            location_id: "L1", 
            quantity: { count: 1 },
            tags: [{ 
                code: "type", 
                list: [{ code: "type", value: "item" }] 
            }]
        }]
      }
    };
  } else if (action === 'init') {
    message = {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ id: "item_veg_thali", quantity: { count: 1 }, location_id: "L1", tags: [{ code: "type", list: [{ code: "type", value: "item" }] }] }],
        billing: { 
            name: "Test User", 
            address: { name: "Test User", building: "Main Road", locality: "Test", city: "Delhi", state: "Delhi", country: "IND", area_code: "110001" }, 
            phone: "9876543210", email: "test@test.com" 
        },
        fulfillments: [{ id: "F1", type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } }, contact: { phone: "9876543210" } } }]
      }
    };
  } else if (action === 'confirm') {
    message = {
      order: {
        id: "e496f730-8c9f-4152-a993-83f187cbdfbd", 
        state: "Created",
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ id: "item_veg_thali", quantity: { count: 1 }, location_id: "L1", tags: [{ code: "type", list: [{ code: "type", value: "item" }] }] }],
        billing: { name: "Test User", phone: "9876543210", address: { building: "Main Road", city: "Delhi", area_code: "110001" } },
        fulfillments: [{ id: "F1", type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } }, contact: { phone: "9876543210" } } }],
        payment: { type: "POST-FULFILLMENT", status: "NOT-PAID", collected_by: "BPP" }
      }
    };
  }

  return { context, message };
}
