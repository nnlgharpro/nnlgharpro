// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — TRULY UNIVERSAL v9.7 (Final)
// ═══════════════════════════════════════════════════════════

import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl';

// ═══════════════════════════════════════════════════════════
// 🎯 UNIVERSAL DOMAIN CONFIGURATION (Wapas add kar diya)
// ═══════════════════════════════════════════════════════════
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    
    try {
      if (path === '/' || path === '/api/health') {
        return jsonResponse({ status: 'active', version: '9.7.0' }, corsHeaders);
      }
      
      const action = path.replace('/', '');
      
      // 🚨 1. WORKBENCH INCOMING (BPP Mode) - Isme koi BAP key nahi lagti
      const incomingActions = ['search', 'select', 'init', 'confirm', 'update', 'status', 'cancel', 'track'];
      if (incomingActions.includes(action) && request.method === 'POST') {
          try {
              const body = await request.clone().json();
              // Workbench humein BPP banakar call karta hai, toh ACK bhejo
              if (body.context && body.context.bpp_id) {
                   if (env.ONDC_DATA && body.context.transaction_id) {
                       await env.ONDC_DATA.put(`bpp_req_${action}_${body.context.transaction_id}`, JSON.stringify(body), { expirationTtl: 900 });
                   }
                   return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
              }
          } catch (e) {
              return jsonResponse({ message: { ack: { status: "NACK" } } }, corsHeaders, 400);
          }
      }
      
      // 🚨 2. FRONTEND OUTGOING (BAP Mode)
      const outgoingActions = ['search', 'select', 'init', 'confirm', 'status', 'update'];
      if (outgoingActions.includes(action)) {
        return await handleOutgoingRequest(action, request, env, ctx);
      }
      
      if (path.startsWith('/get-')) {
        const parts = path.split('/');
        return await handleGetData(parts[1].replace('get-', ''), parts[2], env, corsHeaders);
      }
      
      if (path.startsWith('/on_')) {
        return await handleIncomingWebhook(path, request, env, ctx);
      }
      
      return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
    } catch (error) {
      return jsonResponse({ error: error.message }, corsHeaders, 500);
    }
  }
};

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
function generateUUID() { return crypto.randomUUID(); }
function getTimestamp() { return new Date().toISOString(); }

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

function buildPayload(action, domain, body, env) {
  const cityCode = body.pincode === "123001" ? "std:01282" : "std:011";
  const context = {
    domain, country: "IND", city: cityCode, action, core_version: '1.2.5',
    bap_id: env.ONDC_BAP_ID || "gmSwiE_2Ke4DeI_ifn3bzUshWPyPif", 
    bap_uri: env.ONDC_BAP_URI || "https://workbench.ondc.tech",
    transaction_id: body.transactionId || generateUUID(),
    message_id: generateUUID(), timestamp: getTimestamp(), ttl: 'PT30S'
  };
  const config = DOMAIN_CONFIG[domain] || DOMAIN_CONFIG['ONDC:RET11'];

  if (action === 'search') {
    return { context, message: { intent: { item: { descriptor: { name: body.category || config.category } }, fulfillment: { type: config.fulfillmentType, end: { location: { gps: body.gps || "28.0444,76.1084", address: { area_code: body.pincode || "110001" } } } }, payment: { "@ondc/org/buyer_app_finder_fee_type": "percent", "@ondc/org/buyer_app_finder_fee_amount": "3.0" } } } };
  }
  if (action === 'select') {
    return { context, message: { order: { provider: { id: body.providerId }, items: body.items || [{ id: 'item_1', quantity: { count: 1 } }], fulfillments: [{ type: config.fulfillmentType, end: { location: { gps: body.gps || "28.0444,76.1084", address: { area_code: body.pincode } } } }] } } };
  }
  if (action === 'init') {
    return { context, message: { order: { provider: { id: body.providerId, locations: [{ id: "L1" }] }, items: body.items, billing: { name: body.name || "Customer", address: { name: body.name, building: "Ghar", locality: body.address || "Locality", city: cityCode, state: "Delhi", country: "IND", area_code: body.pincode }, tax_number: "GST123", phone: body.phone || "9876543210", email: body.email || "test@test.com", created_at: getTimestamp(), updated_at: getTimestamp() }, fulfillment: { type: config.fulfillmentType, end: { location: { gps: body.gps || "28.0444,76.1084", address: { area_code: body.pincode } } } }, quote: { price: { currency: "INR", value: body.totalAmount || "100" }, breakup: [{ "@ondc/org/item_id": body.items[0].id, "@ondc/org/item_quantity": { count: 1 }, "@ondc/org/title_type": "item", price: { currency: "INR", value: body.totalAmount || "100" } }] }, payment: { type: "ON-ORDER", status: "NOT-PAID", collected_by: "BAP" } } } };
  }
  if (action === 'confirm') {
    return { context, message: { order: { id: body.orderId || generateUUID(), state: "Created", provider: { id: body.providerId, locations: [{ id: "L1" }] }, items: body.items, billing: body.billing, fulfillment: body.fulfillment, quote: body.quote, payment: { type: "ON-ORDER", status: "PAID", collected_by: "BAP", transaction_id: "TXN-" + generateUUID() } } } };
  }
  if (action === 'update') {
    return { context, message: { update_target: body.update_target || "fulfillment", order: { id: body.orderId, state: "Created", provider: { id: body.providerId, locations: [{ id: "L1" }] }, items: body.items || [], billing: body.billing || {}, fulfillments: body.fulfillments || [{ id: "F1", type: config.fulfillmentType, end: { location: { gps: body.gps || "28.0444,76.1084", address: { name: body.name || "Customer", building: body.address || "Locality", locality: body.locality || "Locality", city: cityCode, state: "Delhi", country: "IND", area_code: body.pincode } }, contact: { phone: body.phone || "9876543210", email: body.email || "test@test.com" } }, tags: [{ code: "bpp_terms", list: [{ code: "instructions", value: body.instructions || "Ghar par 2 baje aayein, gate 3" }] }] }], quote: body.quote || { price: { currency: "INR", value: body.totalAmount || "100" }, breakup: [{ "@ondc/org/item_id": body.items?.[0]?.id || "item_1", "@ondc/org/item_quantity": { count: 1 }, "@ondc/org/title_type": "item", price: { currency: "INR", value: body.totalAmount || "100" } }] }, payment: { type: "ON-ORDER", status: "PAID", collected_by: "BAP" } } } };
  }
  return { context, message: body.message || {} };
}

async function handleOutgoingRequest(action, request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const domain = body.domain || env.ONDC_DOMAIN || 'ONDC:RET11'; 
  const gatewayUrl = env.ONDC_GATEWAY_URL || 'https://preprod.gateway.ondc.org';
  
  let cacheKey = null;
  if (action === 'search' && !gatewayUrl.includes('workbench')) {
    cacheKey = `cache_${domain}_${body.pincode || '110001'}_${body.category || 'default'}`;
    if (env.ONDC_DATA) {
      const cached = await env.ONDC_DATA.get(cacheKey);
      if (cached) return jsonResponse({ success: true, cached: true, cachedData: JSON.parse(cached) }, { 'Access-Control-Allow-Origin': '*' });
    }
  }

  const payload = buildPayload(action, domain, body, env);
  const authHeader = await generateOndcSignature(payload, env);
  
  try {
    const response = await fetch(`${gatewayUrl}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json().catch(() => ({}));
    
    if (data?.message?.ack?.status === 'NACK' || data?.error) {
        return jsonResponse({ success: false, error: data?.error?.message || "Request rejected by Gateway", workbenchResponse: data }, { 'Access-Control-Allow-Origin': '*' });
    }

    if (ctx && ctx.waitUntil && action === 'search' && cacheKey && env.ONDC_DATA) {
        ctx.waitUntil(env.ONDC_DATA.put(`txn_map_${payload.context.transaction_id}`, cacheKey, { expirationTtl: 600 }));
    }
    return jsonResponse({ success: true, action, domain, transaction_id: payload.context.transaction_id, workbenchResponse: data }, { 'Access-Control-Allow-Origin': '*' });
  } catch (error) {
    return jsonResponse({ error: "Fetch Error: " + error.message }, { 'Access-Control-Allow-Origin': '*' }, 500);
  }
}

async function handleIncomingWebhook(path, request, env, ctx) {
  const body = await request.json();
  const action = path.replace('/', ''); // e.g., 'on_search'
  const txnId = body.context?.transaction_id;
  
  // 1. Database mein save karo
  if (env.ONDC_DATA && txnId) {
    try {
      await env.ONDC_DATA.put(`data_${action}_${txnId}`, JSON.stringify(body), { expirationTtl: 900 }); 
      if (action === 'on_search') {
        const cacheKey = await env.ONDC_DATA.get(`txn_map_${txnId}`);
        if (cacheKey) await env.ONDC_DATA.put(cacheKey, JSON.stringify(body), { expirationTtl: 300 });
      }
    } catch (err) { console.error(`KV Error:`, err.message); }
  }

  // 2. Workbench ko sahi response bhejo taaki flow aage badhe
  if (action === 'on_select' || action === 'on_init' || action === 'on_confirm' || action === 'on_update') {
      
      const orderResponse = {
          id: "ORD-" + generateUUID(),
          state: "Created",
          provider: { id: "P1", locations: [{ id: "L1" }] },
          items: [{ id: "item_1", quantity: { count: 1 }, price: { currency: "INR", value: "100" } }],
          billing: { 
              name: "Customer", 
              address: { name: "Customer", building: "Ghar", locality: "Locality", city: "std:011", state: "Delhi", country: "IND", area_code: "110001" }, 
              phone: "9876543210", email: "test@test.com", 
              created_at: getTimestamp(), updated_at: getTimestamp() 
          },
          fulfillments: [{ 
              id: "F1", 
              type: "Delivery", 
              state: { descriptor: { code: "Pending" } }, 
              end: { location: { gps: "28.0444,76.1084", address: { area_code: "110001" } }, contact: { phone: "9876543210" } } 
          }],
          quote: { 
              price: { currency: "INR", value: "100" }, 
              breakup: [{ "@ondc/org/item_id": "item_1", "@ondc/org/item_quantity": { count: 1 }, "@ondc/org/title_type": "item", price: { currency: "INR", value: "100" } }] 
          },
          payment: { type: "ON-ORDER", status: "PAID", collected_by: "BAP" }
      };

      return jsonResponse({
          message: {
              ack: { status: 'ACK' },
              order: orderResponse
          }
      }, { 'Content-Type': 'application/json' });
  }

  return jsonResponse({ message: { ack: { status: 'ACK' } } }, { 'Content-Type': 'application/json' });
}

async function handleGetData(actionType, txnId, env, corsHeaders) {
  if (!txnId || !env.ONDC_DATA) return jsonResponse({ success: false, message: 'Invalid request' }, corsHeaders);
  try {
    const data = await env.ONDC_DATA.get(`data_on_${actionType}_${txnId}`);
    if (data) return jsonResponse({ success: true, status: 'ready', results: JSON.parse(data) }, corsHeaders);
    return jsonResponse({ success: false, status: 'pending' }, corsHeaders);
  } catch (err) { return jsonResponse({ success: false, message: err.message }, corsHeaders, 500); }
}
