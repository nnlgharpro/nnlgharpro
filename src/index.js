// Version 2.0 - Final Fix
import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl'; 

const CORE_VERSION = "1.2.5";
const DEFAULT_CITY = "std:011"; 
const DEFAULT_COUNTRY = "IND";
const TTL_DURATION = "PT30S";

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
      
      // 1. Callbacks
      if (path.startsWith('on_')) {
        let reqBody = {};
        if (request.method === 'POST') {
            try { reqBody = await request.json(); } catch(e) {}
        }
        
        if (path === 'on_select' && reqBody.message && reqBody.message.order) {
            const txId = reqBody.context.transaction_id;
            sessionStore[txId] = reqBody.message.order;
        }
        
        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }

      // 2. Main Actions
      if (path.startsWith('client_') || path === 'search' || path === 'select' || path === 'init' || path === 'confirm') {
        
        const action = path.startsWith('client_') ? path.replace('client_', '') : path;
        
        let reqBody = {};
        if (request.method === 'POST') {
            try { reqBody = await request.json(); } catch(e) {}
        }

        // ✅ FIX: Syntax error theek kiya gaya hai (comment lagaya hai)
        // 🛑 DYNAMIC IDS (Workbench ke according)
        let transactionId = "2ce4a2f8-5d88-479c-bbaf-b4b576f4ee13";
        let messageId = "346c8832-f4b7-42f7-9eff-fc00439da9ee";
        
        if (reqBody.transaction_id) transactionId = reqBody.transaction_id;
        if (reqBody.message_id) messageId = reqBody.message_id;
        
        const domain = reqBody.domain || env.ONDC_DOMAIN || "ONDC:RET11";
        
        const payload = buildPayload(action, domain, reqBody, transactionId, messageId, env);
        
       const gatewayUrl = `https://workbench.ondc.tech/api-service/ONDC:RET11/1.2.5/${action}`;

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
            messageId: messageId
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
  
  const baseItem = { 
    id: "item_veg_thali", 
    location_id: "L1", 
    quantity: { count: 1 },
    tags: [{ code: "type", list: [{ code: "type", value: "item" }] }]
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
    const sessionOrder = sessionStore[transactionId] || {};
    const items = sessionOrder.items || [baseItem];
    const provider = sessionOrder.provider || { id: "provider_workbench_1", locations: [{ id: "L1" }] };

    message = {
      order: {
        provider: provider,
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
    const items = sessionOrder.items || [baseItem];
    const provider = sessionOrder.provider || { id: "provider_workbench_1", locations: [{ id: "L1" }] };
    
    message = {
      order: {
        id: transactionId,
        state: "Created",
        provider: provider,
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
        }],
        payment: { 
            type: "POST-FULFILLMENT", 
            status: "NOT-PAID", 
            collected_by: "BPP" 
        }
      }
    };
  }

  return { context, message };
}
