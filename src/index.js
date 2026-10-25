import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl'; 

const CORE_VERSION = "1.2.5";
const DEFAULT_CITY = "std:011"; 
const DEFAULT_COUNTRY = "IND";
const TTL_DURATION = "PT30S";

// Helper to generate UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

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

        // Dynamic IDs generate karein agar frontend se nahi aaye
        const transactionId = reqBody.transactionId || generateUUID();
        const messageId = generateUUID();
        const domain = reqBody.domain || env.ONDC_DOMAIN || "ONDC:RET11";
        
        // Payload Build Karein
        const payload = buildPayload(action, domain, reqBody, transactionId, messageId, env);
        
        // Gateway URL
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

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

function buildPayload(action, domain, body, transactionId, messageId, env) {
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
    message_id: messageId,
    timestamp: timestamp, 
    ttl: 'PT30S'
  };

  let message = {};
  
  // Common Item Structure with Tags
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
        fulfillment: { type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } } } }
      }
    };
  } 
  else if (action === 'select') {
    // ✅ PURE SELECT PAYLOAD (No billing, No fulfillments)
    message = {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [baseItem]
      }
    };
  } 
  else if (action === 'init') {
    message = {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [baseItem],
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
    message = {
      order: {
        id: transactionId, // Order ID can be same as transaction ID for mock
        state: "Created",
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [baseItem],
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
        payment: { type: "POST-FULFILLMENT", status: "NOT-PAID", collected_by: "BPP" }
      }
    };
  }

  return { context, message };
}
