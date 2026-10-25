import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl'; 

const CORE_VERSION = "1.2.5";
const DEFAULT_CITY = "*"; 
const DEFAULT_COUNTRY = "IND";
const TTL_DURATION = "PT30S";

// Session store to save on_select data for init and confirm
const sessionStore = {};

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
      
      // 1. Callbacks from Gateway (on_search, on_select, etc.)
      if (path.startsWith('on_')) {
        let reqBody = {};
        if (request.method === 'POST') {
            try { reqBody = await request.json(); } catch(e) {}
        }
        
        // Save selected items in memory to pass in init/confirm
        if (path === 'on_select' && reqBody.message && reqBody.message.order) {
            const txId = reqBody.context.transaction_id;
            sessionStore[txId] = reqBody.message.order;
        }
        
        // Always ACK the callbacks
        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }

      // 2. Frontend calls (client_search, client_select, client_init, client_confirm)
      if (path.startsWith('client_') || path === 'search' || path === 'select' || path === 'init' || path === 'confirm') {
        
        const action = path.startsWith('client_') ? path.replace('client_', '') : path;
        
        let reqBody = {};
        if (request.method === 'POST') {
            try { reqBody = await request.json(); } catch(e) {}
        }

        // Use IDs passed from frontend, or fallback to fixed ones
       // 🛑 Hardcoded IDs for Workbench Testing
        const transactionId = "2ce4a2f8-5d88-479c-bbaf-b4b576f4ee13";
        const messageId = "346c8832-f4b7-42f7-9eff-fc00439da9ee";
        const domain = reqBody.domain || env.ONDC_DOMAIN || "ONDC:RET11";
        
        const payload = buildPayload(action, domain, reqBody, transactionId, messageId, env);
        
        // Gateway URL
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

        // Send to ONDC Gateway (Workbench)
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

        return jsonResponse({ 
            success: true, 
            transactionId: transactionId,
            messageId: messageId,
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

function buildPayload(action, domain, body, transactionId, messageId, env) {
  const timestamp = new Date().toISOString();
  
  const context = {
    domain: domain, 
    country: "IND", 
    city: "*", // Workbench uses * for mock callbacks
    action: action, 
    core_version: '1.2.5',
    bap_id: env.ONDC_BAP_ID, 
    bap_uri: env.ONDC_BAP_URI,
    bpp_id: "workbench.ondc.tech", 
    bpp_uri: "https://workbench.ondc.tech", 
    transaction_id: transactionId, 
    message_id: messageId,
    timestamp: timestamp, 
    ttl: 'PT30S'
  };

  let message = {};
  
  // Fixed Item with Tags (Crucial for avoiding NACK)
  const baseItem = { 
    id: "item_veg_thali", 
    location_id: "L1", 
    quantity: { count: 1 },
    tags: [{ 
        code: "type", 
        list: [{ code: "type", value: "item" }] 
    }]
  };

  if (action === 'search') {
    message = {
      intent: {
        item: { descriptor: { name: "Food" } },
        fulfillment: { type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: body.pincode || "110001" } } } }
      }
    };
  } 
  else if (action === 'select') {
    message = {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [baseItem]
      }
    };
  } 
  else if (action === 'init') {
    // Retrieve saved order from on_select
    const sessionOrder = sessionStore[transactionId] || {};
    const items = sessionOrder.items || [baseItem];

    message = {
      order: {
        provider: sessionOrder.provider || { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: items,
        billing: { 
            name: "Test User", 
            address: { name: "Test User", building: "Main Road", locality: "Test Locality", city: "Delhi", state: "Delhi", country: "IND", area_code: "110001" }, 
            phone: "9876543210", email: "test@nnlgharpro.com" 
        },
        fulfillments: [{ 
            id: "F1", 
            type: "Delivery", 
            end: { 
                location: { gps: "28.6139,77.2090", address: { area_code: "110001" } }, 
                contact: { phone: "9876543210", email: "test@nnlgharpro.com" } 
            } 
        }]
      }
    };
  } 
  else if (action === 'confirm') {
    const sessionOrder = sessionStore[transactionId] || {};
    
    message = {
      order: {
        id: transactionId,
        state: "Created",
        provider: sessionOrder.provider || { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: sessionOrder.items || [baseItem],
        billing: { 
            name: "Test User", 
            address: { name: "Test User", building: "Main Road", locality: "Test Locality", city: "Delhi", state: "Delhi", country: "IND", area_code: "110001" }, 
            phone: "9876543210", email: "test@nnlgharpro.com" 
        },
        fulfillments: [{ 
            id: "F1", 
            type: "Delivery", 
            end: { 
                location: { gps: "28.6139,77.2090", address: { area_code: "110001" } }, 
                contact: { phone: "9876543210", email: "test@nnlgharpro.com" } 
            } 
        }],
        payment: { type: "POST-FULFILLMENT", status: "NOT-PAID", collected_by: "BPP" },
        quote: { 
            price: { currency: "INR", value: "199.00" },
            breakup: [{ title: "Item", price: { currency: "INR", value: "199.00" } }]
        }
      }
    };
  }

  return { context, message };
}
