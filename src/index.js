import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl'; 

const CORE_VERSION = "1.2.5";
const DEFAULT_CITY = "std:011"; 
const DEFAULT_COUNTRY = "IND";
const TTL_DURATION = "PT30S";

// Temporary in-memory store for session (Workers mein ye volatile hota hai, but for testing it works)
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
      
      // 1. Gateway Callbacks (on_)
      if (path.startsWith('on_')) {
        let reqBody = {};
        if (request.method === 'POST') {
            try { reqBody = await request.json(); } catch(e) {}
        }
        
        // Session mein data save karein agar on_select aaye
        if (path === 'on_select' && reqBody.message && reqBody.message.order) {
            const txId = reqBody.context.transaction_id;
            sessionStore[txId] = reqBody.message.order;
            console.log("Session saved for tx:", txId);
        }
        
        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }

      // 2. Frontend/Workbench Trigger APIs
      if (path.startsWith('client_') || path === 'search' || path === 'select' || path === 'init' || path === 'confirm') {
        
        const action = path.startsWith('client_') ? path.replace('client_', '') : path;
        
        let reqBody = {};
        if (request.method === 'POST') {
            try { reqBody = await request.json(); } catch(e) {}
        }

        const transactionId = reqBody.transactionId || "e496f730-8c9f-4152-a993-83f187cbdfbd";
        
        // 🛑 FIX: message_id Workbench se aana chahiye ya fixed hona chahiye
        // Agar frontend se nahi aa raha, to hum fixed ID use karenge jisse mismatch na ho
        const messageId = reqBody.messageId || "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"; 

        const domain = reqBody.domain || env.ONDC_DOMAIN || "ONDC:RET11";
        
        // Payload Build Karein
        const payload = buildPayload(action, domain, reqBody, transactionId, messageId, env);
        
        // Gateway URL
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

        // Gateway ko request bhejein
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
            messageId: messageId, // Frontend ko bata dein
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
    city: "*", // Workbench often uses * for city in callbacks
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
  
  // Base Item
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
    message = {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [baseItem]
      }
    };
  } 
  else if (action === 'init') {
    // Agar session mein pehle se data hai to use karein, warna baseItem
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
        quote: sessionOrder.quote || { // Mock quote if not present
            price: { currency: "INR", value: "100.00" },
            breakup: [{ title: "Item", price: { currency: "INR", value: "100.00" } }]
        }
      }
    };
  }

  return { context, message };
}
