// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — FINAL FIXED (v12.8)
// ═══════════════════════════════════════════════════════════
import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl';

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
        return jsonResponse({ status: 'active', version: '12.8.0' }, corsHeaders);
      }
      
      const mockProviders = [{
          id: "provider_workbench_1",
          descriptor: { name: "NnlGharPro Test Kitchen" },
          locations: [{ id: "L1", gps: "28.6139,77.2090" }],
          items: [{
              id: "item_veg_thali",
              descriptor: { name: "Standard Veg Thali (ONDC Verified)", short_desc: "Clears Workbench Testing Flow" },
              category_id: "RET11-Meals",
              fulfillment_id: "F1",
              location_id: "L1",
              price: { currency: "INR", value: "150.00" }
          }]
      }];

      // 🚨 1. GATEWAY INCOMING CALLBACKS (on_search, on_select, etc.)
      if (path.startsWith('on_')) {
        const body = await request.json();
        const txnId = body.context?.transaction_id;
        const action = body.context?.action;

        if (env.ONDC_DATA && txnId) {
            await env.ONDC_DATA.put(`bap_callback_${action}_${txnId}`, JSON.stringify(body), { expirationTtl: 900 });
        }
        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }

      // 🚨 2. FRONTEND OUTGOING (client_search, client_select, etc.)
      if (path.startsWith('client_')) {
        const action = path.replace('client_', '');
        const reqBody = await request.json();
        
        // ✅ FIX: Agar frontend se transactionId aayi hai toh use karo, warna nayi banao
        const transactionId = reqBody.transactionId || crypto.randomUUID();
        // ✅ FIX: Domain ko reqBody se lo, warna default RET11
        const domain = reqBody.domain || env.ONDC_DOMAIN || "ONDC:RET11";
        
        const payload = buildBapPayload(action, domain, reqBody, transactionId, env);
        const authHeader = await generateOndcSignature(payload, env);
        
        // ✅ FIX: URL ke aage action (jaise /search ya /select) lagana zaroori hai
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

        ctx.waitUntil(
          fetch(gatewayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Gateway-Authorization': authHeader, 'Authorization': authHeader },
            body: JSON.stringify(payload)
          })
          .then(async (res) => {
            const text = await res.text();
            console.log(`[CLIENT_${action.toUpperCase()}] Status: ${res.status} | Response: ${text}`);
          })
          .catch((e) => console.log(`[CLIENT_${action.toUpperCase()}] Fetch Error:`, e.message))
        );

        // Frontend ko wapas transactionId bhejna zaroori hai taaki wo select mein use kare
        return jsonResponse({ 
            success: true, 
            transactionId: transactionId, // <-- YEH SABSE ZAROORI HAI
            results: mockProviders,
            providers: mockProviders
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

async function generateOndcSignature(body, env) {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 3600;
  const encoder = new TextEncoder();
  
  const payloadString = JSON.stringify(body);
  const data = encoder.encode(payloadString);
  const hashBuffer = blake2b(data, null, 64);
  const digest = btoa(String.fromCharCode(...hashBuffer));
  
  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

  let rawKey = env.ONDC_SIGNING_PRIVATE_KEY || "";
  rawKey = rawKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (rawKey.length % 4) { rawKey += '='; }
  
  const privateKeyBytes = Uint8Array.from(atob(rawKey), c => c.charCodeAt(0));
  let secretKey;
  if (privateKeyBytes.length === 32) {
    secretKey = nacl.sign.keyPair.fromSeed(privateKeyBytes).secretKey;
  } else {
    secretKey = privateKeyBytes; 
  }

  const signatureBytes = nacl.sign.detached(encoder.encode(signingString), secretKey);
  const signature = btoa(String.fromCharCode(...signatureBytes));
  
  return `Signature keyId="${env.ONDC_BAP_ID}|${env.ONDC_UK_ID}|ed25519",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

function buildBapPayload(action, domain, body, transactionId, env) {
  const timestamp = new Date().toISOString();
  
  // Common Context for all requests
  const context = {
    domain: domain, 
    country: "IND", 
    city: "std:011", 
    action: action, 
    core_version: '1.2.5',
    bap_id: env.ONDC_BAP_ID, 
    bap_uri: env.ONDC_BAP_URI,
    transaction_id: transactionId, 
    message_id: crypto.randomUUID(), 
    timestamp: timestamp, 
    ttl: 'PT30S'
  };

  let message = {};

  if (action === 'search') {
    message = {
      intent: {
        item: { descriptor: { name: "Food" } },
        fulfillment: { type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: body.pincode || "110001" } } } },
        tags: [
          { code: "BAP_TERMS", list: [ { code: "STATIC_SIGNATURE_REQ", value: "true" }, { code: "FINDER_FEE_TYPE", value: "percent" }, { code: "FINDER_FEE_AMOUNT", value: "3.0" } ] }
        ]
      }
    };
  } else if (action === 'select') {
    message = {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ id: "item_veg_thali", quantity: { count: 1 } }],
        billing: {
          name: "Test User",
          address: { name: "Test User", building: "Main Road", locality: "Test Locality", city: "Delhi", state: "Delhi", country: "IND", area_code: body.pincode || "110001" },
          phone: "9876543210", email: "test@nnlgharpro.com"
        },
        fulfillments: [{
          id: "F1", type: "Delivery",
          end: {
            location: { gps: "28.6139,77.2090", address: { name: "Test User", building: "Main Road", locality: "Test Locality", city: "Delhi", state: "Delhi", country: "IND", area_code: body.pincode || "110001" } },
            contact: { phone: "9876543210", email: "test@nnlgharpro.com" }
          }
        }]
      }
    };
  } else if (action === 'init') {
    message = {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ id: "item_veg_thali", quantity: { count: 1 } }],
        billing: { name: "Test User", address: { name: "Test User", building: "Main Road", city: "Delhi", state: "Delhi", country: "IND", area_code: "110001" }, phone: "9876543210", email: "test@nnlgharpro.com" },
        fulfillments: [{ id: "F1", type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } } } }]
      }
    };
  } else if (action === 'confirm') {
    message = {
      order: {
        id: crypto.randomUUID(), state: "Created",
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ id: "item_veg_thali", quantity: { count: 1 } }],
        billing: { name: "Test User", phone: "9876543210", address: { building: "Main Road", city: "Delhi", area_code: "110001" } },
        fulfillments: [{ id: "F1", type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } } } }],
        payment: { uri: "https://razorpay.com", tls_method: "string", status: "PAID", type: "ON-ORDER", collected_by: "BAP" }
      }
    };
  } else if (action === 'update') {
    message = {
      order: {
        id: body.orderId || "YOUR_EXISTING_ORDER_ID", 
        fulfillments: [{ id: "F1", type: "Delivery", end: { location: { gps: body.newGps || "28.6139,77.2090", address: { name: body.newName || "Test User", building: body.newBuilding || "New Building, Flat 402", locality: body.newLocality || "New Locality", city: body.newCity || "Delhi", state: body.newState || "Delhi", country: "IND", area_code: body.newAreaCode || "110001" } }, instructions: { name: "delivery_instructions", short_desc: body.instructions || "Please ring the bell twice." } } }]
      }
    };
  }

  return { context, message };
}
