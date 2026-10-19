// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — Ultra Fast (Cached) - v7.0
// ═══════════════════════════════════════════════════════════

import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    console.log(`📥 ${request.method} ${path}`);
    
    try {
      if (path === '/' || path === '/api/health') {
        return jsonResponse({ status: 'active', version: '7.0.0' }, corsHeaders);
      }
      
      // Outgoing Actions
      const outgoingActions = ['search', 'select', 'init', 'confirm', 'status', 'cancel', 'update', 'track', 'support', 'rating'];
      const action = path.replace('/', '');
      
      if (outgoingActions.includes(action)) {
        return await handleOutgoingRequest(action, request, env, ctx);
      }
      
      // Get Search Results
      if (path.startsWith('/get-results/')) {
        const txnId = path.split('/')[2];
        return await handleGetResults(txnId, env, corsHeaders);
      }

      // Get Select (Menu) Results
      if (path.startsWith('/get-select/')) {
        const txnId = path.split('/')[2];
        return await handleGetSelect(txnId, env, corsHeaders);
      }
      
      // Incoming Webhooks
      if (path.startsWith('/on_')) {
        return await handleIncomingWebhook(path, request, env, ctx);
      }
      
      return jsonResponse({ error: 'Not found', path: path }, corsHeaders, 404);
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      return jsonResponse({ error: error.message, path: path }, corsHeaders, 500);
    }
  }
};

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
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
  rawKey = rawKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  rawKey = rawKey.replace(/-/g, '+').replace(/_/g, '/');
  while (rawKey.length % 4) { rawKey += '='; }
  
  const privateKeyBytes = Uint8Array.from(atob(rawKey), c => c.charCodeAt(0));
  let secretKey = privateKeyBytes;
  if (privateKeyBytes.length === 32) {
      secretKey = nacl.sign.keyPair.fromSeed(privateKeyBytes).secretKey;
  } else if (privateKeyBytes.length !== 64) {
      throw new Error(`Invalid private key length.`);
  }

  const messageBytes = encoder.encode(signingString);
  const signatureBytes = nacl.sign.detached(messageBytes, secretKey);
  const signature = btoa(String.fromCharCode(...signatureBytes));
  
  return `Signature keyId="${env.ONDC_BAP_ID}|${env.ONDC_UK_ID}|ed25519",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

function buildPayload(action, domain, body, env) {
  let cityCode = "std:011"; 
  if (body.pincode === "123001") cityCode = "std:01282";

  const context = {
    domain: domain,
    country: "IND",           
    city: cityCode,           
    action: action,
    core_version: '1.2.5',    
    bap_id: env.ONDC_BAP_ID,
    bap_uri: env.ONDC_BAP_URI,
    transaction_id: body.transactionId || generateUUID(),
    message_id: generateUUID(),
    timestamp: getTimestamp(),
    ttl: 'PT30S'
  };

  if (domain.startsWith('ONDC:RET')) {
    if (action === 'search') {
      return {
        context,
        message: {
          intent: {
            item: { descriptor: { name: body.category || 'Food' } },
            fulfillment: { type: 'Delivery', end: { location: { gps: "28.0444,76.1084", address: { area_code: body.pincode || "123001" } } } },
            payment: { "@ondc/org/buyer_app_finder_fee_type": "percent", "@ondc/org/buyer_app_finder_fee_amount": "3.0" }
          }
        }
      };
    }
    if (action === 'select') {
      return {
        context,
        message: {
          order: {
            provider: { id: body.providerId || 'provider_1' },
            items: [{ id: body.itemId || 'item_1', quantity: { count: 1 } }],
            fulfillments: [{ type: 'Delivery', end: { location: { gps: "28.0444,76.1084", address: { area_code: body.pincode || "123001" } } } }]
          }
        }
      };
    }
  }
  return { context, message: { intent: body.intent || {}, order: body.order || {} } };
}

// ═══════════════════════════════════════════════════════════
// 🚀 OUTGOING HANDLER (WITH CACHE)
// ═══════════════════════════════════════════════════════════
async function handleOutgoingRequest(action, request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const domain = body.domain || env.ONDC_DOMAIN || 'ONDC:RET11'; 
  
  // 🚀 CACHING LOGIC FOR SEARCH
  let cacheKey = null;
  if (action === 'search') {
    cacheKey = `cache_search_${domain}_${body.pincode || '110001'}_${body.category || 'Food'}`;
    
    if (env.ONDC_DATA) {
      const cached = await env.ONDC_DATA.get(cacheKey);
      if (cached) {
        console.log(`⚡ Serving from CACHE: ${cacheKey}`);
        return jsonResponse({ 
          success: true, 
          cached: true, 
          action: action,
          transaction_id: generateUUID(),
          cachedData: JSON.parse(cached) // Frontend ko direct data bhej rahe hain
        }, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
      }
    }
  }

  const payload = buildPayload(action, domain, body, env);
  const authHeader = await generateOndcSignature(payload, env);
  const gatewayUrl = env.ONDC_GATEWAY_URL || 'https://preprod.gateway.ondc.org';
  
  try {
    const response = await fetch(`${gatewayUrl}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json().catch(() => ({}));
    
    // Save TXN map for webhook to know which cache to update
    if (ctx && ctx.waitUntil && action === 'search' && cacheKey) {
        ctx.waitUntil(env.ONDC_DATA.put(`txn_map_${payload.context.transaction_id}`, cacheKey, { expirationTtl: 600 }));
    }
    
    return jsonResponse({ 
      success: true, action: action, domain: domain,
      transaction_id: payload.context.transaction_id,
      workbenchResponse: data 
    }, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });

  } catch (error) {
    return jsonResponse({ error: "Fetch Error: " + error.message }, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, 500);
  }
}

// ═══════════════════════════════════════════════════════════
// 🚀 INCOMING WEBHOOK HANDLER (SAVES TO CACHE)
// ═══════════════════════════════════════════════════════════
async function handleIncomingWebhook(path, request, env, ctx) {
  const body = await request.json();
  const action = path.replace('/', '');
  const txnId = body.context?.transaction_id;
  
  console.log(`📥 [WEBHOOK] ${action} received for TXN: ${txnId}`);

  if (action === 'on_search' && txnId && env.ONDC_DATA) {
    try {
      await env.ONDC_DATA.put(`txn_${txnId}`, JSON.stringify(body), { expirationTtl: 900 }); 
      
      // 🚀 SAVE TO CACHE FOR 5 MINUTES (300 seconds)
      const cacheKey = await env.ONDC_DATA.get(`txn_map_${txnId}`);
      if (cacheKey) {
          await env.ONDC_DATA.put(cacheKey, JSON.stringify(body), { expirationTtl: 300 });
          console.log(`✅ Cached data for: ${cacheKey}`);
      }
    } catch (err) { console.error(`❌ KV Error:`, err.message); }
  }

  if (action === 'on_select' && txnId && env.ONDC_DATA) {
    try {
      await env.ONDC_DATA.put(`select_${txnId}`, JSON.stringify(body), { expirationTtl: 900 }); 
    } catch (err) { console.error(`❌ KV Error:`, err.message); }
  }

  return jsonResponse({ message: { ack: { status: 'ACK' } } }, { 'Content-Type': 'application/json' });
}

async function handleGetResults(txnId, env, corsHeaders) {
  if (!txnId || !env.ONDC_DATA) return jsonResponse({ success: false }, corsHeaders);
  try {
    const data = await env.ONDC_DATA.get(`txn_${txnId}`);
    if (data) return jsonResponse({ success: true, status: 'ready', results: JSON.parse(data) }, corsHeaders);
    return jsonResponse({ success: false, status: 'pending' }, corsHeaders);
  } catch (err) { return jsonResponse({ success: false, message: err.message }, corsHeaders, 500); }
}

async function handleGetSelect(txnId, env, corsHeaders) {
  if (!txnId || !env.ONDC_DATA) return jsonResponse({ success: false }, corsHeaders);
  try {
    const data = await env.ONDC_DATA.get(`select_${txnId}`);
    if (data) return jsonResponse({ success: true, status: 'ready', results: JSON.parse(data) }, corsHeaders);
    return jsonResponse({ success: false, status: 'pending' }, corsHeaders);
  } catch (err) { return jsonResponse({ success: false, message: err.message }, corsHeaders, 500); }
}

console.log('✅ NnlGharPro ONDC Ultra Fast API v7.0 loaded');
