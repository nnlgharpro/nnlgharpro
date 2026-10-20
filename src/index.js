// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — TRULY UNIVERSAL v9.8.5 (Fixed Master)
// ═══════════════════════════════════════════════════════════

import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl';

const DOMAIN_CONFIG = {
  'ONDC:RET11': { category: 'Food', fulfillmentType: 'Delivery' },
  'ONDC:RET10': { category: 'Grocery', fulfillmentType: 'Delivery' },
  'ONDC:RET12': { category: 'Fashion', fulfillmentType: 'Delivery' },
  'ONDC:RET14': { category: 'Electronics', fulfillmentType: 'Delivery' },
  'ONDC:RET13': { category: 'Beauty', fulfillmentType: 'Delivery' },
  'ONDC:RET15': { category: 'Home Decor', fulfillmentType: 'Delivery' }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gateway-Authorization',
    };
    
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    
    try {
      if (path === '/' || path === '/api/health') {
        return jsonResponse({ status: 'active', version: '9.8.5', type: 'Universal Master Node' }, corsHeaders);
      }
      
      const action = path.replace('/', '');
      
      // 🚨 1. WORKBENCH INCOMING (BPP Mode - जब आपका ऐप Seller की तरह काम कर रहा हो)
      const incomingActions = ['search', 'select', 'init', 'confirm', 'update', 'status', 'cancel', 'track'];
      if (incomingActions.includes(action) && request.method === 'POST') {
          try {
              const body = await request.json();
              
              // बैकग्राउंड में एसिंक्रोनस रिस्पांस ट्रिगर करें (Workbench को जवाब भेजने के लिए)
              ctx.waitUntil(handleAsynchronousBppCallback(action, body, env));
              
              // तुरंत सिन्क्रोनस ACK नेटवर्क रिस्पांस दें
              return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
          } catch (e) {
              return jsonResponse({ message: { ack: { status: "NACK" }, error: { message: e.message } } }, corsHeaders, 400);
          }
      }
      
      // 🚨 2. FRONTEND OUTGOING (BAP Mode - जब आपका ऐप Buyer की तरह काम कर रहा हो)
      const outgoingActions = ['client_search', 'client_select', 'client_init', 'client_confirm'];
      if (outgoingActions.includes(action) && request.method === 'POST') {
        return await handleOutgoingBapRequest(action.replace('client_', ''), request, env, corsHeaders);
      }
      
      // 🚨 3. GATEWAY INCOMING CALLBACKS (BAP Mode - जब Gateway/Seller आपके Buyer को रिप्लाई दे)
      if (path.startsWith('/on_')) {
        const body = await request.json();
        if (env.ONDC_DATA && body.context && body.context.transaction_id) {
            await env.ONDC_DATA.put(`bap_callback_${action}_${body.context.transaction_id}`, JSON.stringify(body), { expirationTtl: 900 });
        }
        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }
      
      return jsonResponse({ error: 'Endpoint route not found' }, corsHeaders, 404);
    } catch (error) {
      return jsonResponse({ error: error.message }, corsHeaders, 500);
    }
  }
};

// ═══════════════════════════════════════════════════════════
// 🧠 SELLER ASYNCHRONOUS CALLBACK ENGINE (BPP AUTOMATION)
// ═══════════════════════════════════════════════════════════
async function handleAsynchronousBppCallback(action, incomingBody, env) {
  const callbackAction = `on_${action}`;
  const domain = incomingBody.context.domain;
  
  const context = {
    domain: domain,
    country: "IND",
    city: incomingBody.context.city || "std:011",
    action: callbackAction,
    core_version: incomingBody.context.core_version || "1.2.5",
    bap_id: incomingBody.context.bap_id,
    bap_uri: incomingBody.context.bap_uri,
    bpp_id: "nnlgharpro-ret11", 
    bpp_uri: "https://workers.dev",
    transaction_id: incomingBody.context.transaction_id,
    message_id: incomingBody.context.message_id,
    timestamp: new Date().toISOString(),
    ttl: "PT30S"
  };

  let message = {};

  if (action === 'search') {
    message = {
      catalog: {
        "bpp/descriptor": { name: "NnlGharPro Universal Store" },
        "bpp/providers": [{
          id: "provider_1",
          descriptor: { name: "Premium Service Hub" },
          locations: [{ id: "L1", gps: "28.6139,77.2090" }],
          items: [{
            id: "item_default",
            descriptor: { name: "Standard Veg Thali / Service", short_desc: "ONDC Automated Fulfillments" },
            category_id: "RET11-Meals",
            fulfillment_id: "F1",
            location_id: "L1",
            price: { currency: "INR", value: "150.00" }
          }]
        }]
      }
    };
  } else {
    message = { ...incomingBody.message }; 
  }

  const completePayload = { context, message };
  const authHeader = await generateOndcSignature(completePayload, env);

  // Workbench Gateway को वापस डाटा पोस्ट करें
  await fetch(env.ONDC_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(completePayload)
  });
}

// ═══════════════════════════════════════════════════════════
// 🧠 BUYER OUTGOING ROUTINE (BAP REQUESTS TO GATEWAY)
// ═══════════════════════════════════════════════════════════
async function handleOutgoingBapRequest(action, request, env, corsHeaders) {
  const reqBody = await request.json();
  const domain = env.ONDC_DOMAIN || "ONDC:RET11";
  
  const payload = buildBapPayload(action, domain, reqBody, env);
  const authHeader = await generateOndcSignature(payload, env);

  const gatewayResponse = await fetch(env.ONDC_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(payload)
  });

  const resData = await gatewayResponse.json();
  return jsonResponse({ client_ack: resData, transactionId: payload.context.transaction_id }, corsHeaders);
}

// ═══════════════════════════════════════════════════════════
// 🛠️ CRYPTOGRAPHIC CRYPTO ENGINE (Ed25519 Signing)
// ═══════════════════════════════════════════════════════════
function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

async function generateOndcSignature(body, env) {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 3600;
  const encoder = new TextEncoder();
  
  const data = encoder.encode(JSON.stringify(body));
  const hashBuffer = blake2b(data, null, 64);
  const digest = btoa(String.fromCharCode(...hashBuffer));
  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

  let rawKey = env.ONDC_SIGNING_PRIVATE_KEY || "";
  rawKey = rawKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (rawKey.length % 4) { rawKey += '='; }
  
  const privateKeyBytes = Uint8Array.from(atob(rawKey), c => c.charCodeAt(0));
  let secretKey = privateKeyBytes.length === 32 ? nacl.sign.keyPair.fromSeed(privateKeyBytes).secretKey : privateKeyBytes;

  const signatureBytes = nacl.sign.detached(encoder.encode(signingString), secretKey);
  const signature = btoa(String.fromCharCode(...signatureBytes));
  
  return `Signature keyId="${env.ONDC_BAP_ID}|${env.ONDC_UK_ID}|ed25519",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

function buildBapPayload(action, domain, body, env) {
  const context = {
    domain, country: "IND", city: "std:011", action, core_version: '1.2.5',
    bap_id: env.ONDC_BAP_ID, bap_uri: env.ONDC_BAP_URI,
    transaction_id: body.transactionId || crypto.randomUUID(),
    message_id: crypto.randomUUID(), timestamp: new Date().toISOString(), ttl: 'PT30S'
  };

  if (action === 'search') {
    return {
      context,
      message: {
        intent: {
          item: { descriptor: { name: body.category || "Food" } },
          fulfillment: { type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: body.pincode || "110001" } } } },
          payment: { "@ondc/org/buyer_app_finder_fee_type": "percent", "@ondc/org/buyer_app_finder_fee_amount": "3.0" }
        }
      }
    };
  }
  return { context, message: {} };
}
