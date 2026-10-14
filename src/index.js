// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — Universal (With KV & Signature) - FINAL v5.2
// ═══════════════════════════════════════════════════════════

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
        return jsonResponse({
          status: 'active',
          service: 'NnlGharPro ONDC Universal API (Secure)',
          version: '5.2.0',
          timestamp: new Date().toISOString()
        }, corsHeaders);
      }
      
      // Registry Lookup
      if (path === '/registry-lookup') {
        const bapId = env.ONDC_BAP_ID || "nnlgharpro-ret11.nnlgharpro.workers.dev";
        const lookupBody = {
          subscriber_id: bapId,
          domain: env.ONDC_DOMAIN || "ONDC:SRV11"
        };
        
        console.log("🔍 Registry Lookup Body:", JSON.stringify(lookupBody));

        try {
          const authHeader = await generateOndcSignature(lookupBody, env);
          const regResponse = await fetch('https://preprod.registry.ondc.org/v2.0/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
            body: JSON.stringify(lookupBody),
            cf: { insecureSkipVerify: true }
          });
          const regData = await regResponse.json();
          return jsonResponse({ success: true, sentBody: lookupBody, authHeaderPreview: authHeader.substring(0, 100), registryResponse: regData }, corsHeaders);
        } catch (regError) {
          return jsonResponse({ success: false, error: regError.message }, corsHeaders, 500);
        }
      }
      
      // Outgoing
      const outgoingActions = ['search', 'select', 'init', 'confirm', 'status', 'cancel', 'update', 'track', 'support', 'rating'];
      const action = path.replace('/', '');
      
      if (outgoingActions.includes(action)) {
        return await handleOutgoingRequest(action, request, env, ctx);
      }
      
      // Get results
      if (path.startsWith('/get-results/')) {
        const txnId = path.split('/')[2];
        return await handleGetResults(txnId, env, corsHeaders);
      }
      
      // Incoming webhooks
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

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

function generateUUID() { return crypto.randomUUID(); }
function getTimestamp() { return new Date().toISOString(); }

// ═══════════════════════════════════════════════════════════
// SIGNATURE GENERATOR
// ═══════════════════════════════════════════════════════════

async function generateOndcSignature(body, env) {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 3600;

  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(body));
  const hashBuffer = blake2b512(data);
  const digest = btoa(String.fromCharCode(...hashBuffer));

  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

  let rawKey = env.ONDC_SIGNING_PRIVATE_KEY || "";
  rawKey = rawKey.replace(/['"]/g, '').replace(/\\n/g, '').replace(/\s/g, '');
  rawKey = rawKey.replace(/-/g, '+').replace(/_/g, '/');

  while (rawKey.length % 4) { rawKey += '='; }

  const rawBinary = Uint8Array.from(atob(rawKey), c => c.charCodeAt(0));
  let binaryDer;

  const pkcs8Prefix = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 
    0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 
    0x04, 0x20
  ]);

  if (rawBinary.length === 32) {
    binaryDer = new Uint8Array(pkcs8Prefix.length + 32);
    binaryDer.set(pkcs8Prefix);
    binaryDer.set(rawBinary, pkcs8Prefix.length);
  } else if (rawBinary.length === 64) {
    binaryDer = new Uint8Array(pkcs8Prefix.length + 32);
    binaryDer.set(pkcs8Prefix);
    binaryDer.set(rawBinary.slice(0, 32), pkcs8Prefix.length);
  } else {
    binaryDer = rawBinary;
  }

  const privateKey = await crypto.subtle.importKey("pkcs8", binaryDer.buffer, { name: "Ed25519" }, false, ["sign"]);

  const signatureBuffer = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, encoder.encode(signingString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  const ukId = env.ONDC_UK_ID || "fe215f60-64c4-4e9a-8153-1b221773777b";
  const keyId = `${env.ONDC_BAP_ID}|${ukId}|ed25519`; 
  
  return `Signature keyId="${keyId}",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

// ═══════════════════════════════════════════════════════════
// PAYLOAD BUILDER
// ═══════════════════════════════════════════════════════════

function buildPayload(action, domain, body, env) {
  const context = {
    domain: domain,
    action: action,
    version: '1.2.5',
    bap_id: env.ONDC_BAP_ID,
    bap_uri: env.ONDC_BAP_URI,
    transaction_id: body.transactionId || generateUUID(),
    message_id: generateUUID(),
    timestamp: getTimestamp(),
    ttl: 'PT30S'
  };

  if (domain.startsWith('ONDC:SRV')) {
    if (action === 'search') {
      return {
        context,
        message: {
          intent: {
            item: { descriptor: { name: body.query || 'Plumber' } },
            fulfillment: { type: 'SERVICE', end: { location: { gps: '28.0444,76.1084', address: { area_code: body.pincode || '123001' } } } },
            payment: { '@ondc/org/buyer_app_finder_fee_type': 'percent', '@ondc/org/buyer_app_finder_fee_amount': '3' }
          }
        }
      };
    }
    return {
      context,
      message: {
        order: {
          provider: { id: body.providerId || 'provider_1' },
          items: body.items || [{ id: 'item_1', quantity: { count: 1 } }],
          fulfillment: { type: 'SERVICE', end: { location: { gps: '28.0444,76.1084', address: { area_code: '123001' } } } },
          billing: body.billing,
          payment: body.payment
        }
      }
    };
  }

  if (domain.startsWith('ONDC:RET')) {
    if (action === 'search') {
      return {
        context,
        message: {
          intent: {
            category: { descriptor: { name: body.category || 'Food' } },
            fulfillment: { type: 'Delivery', end: { location: { gps: '28.0444,76.1084', address: { area_code: body.pincode || '123001' } } } },
            payment: { '@ondc/org/buyer_app_finder_fee_type': 'percent', '@ondc/org/buyer_app_finder_fee_amount': '3' }
          }
        }
      };
    }
    return {
      context,
      message: {
        order: {
          provider: { id: body.providerId || 'provider_1' },
          items: body.items || [{ id: 'item_1', quantity: { count: 1 } }],
          fulfillment: { type: 'Delivery', end: { location: { gps: '28.0444,76.1084', address: { area_code: '123001' } } } },
          billing: body.billing,
          payment: body.payment
        }
      }
    };
  }

  return { context, message: { intent: body.intent || {}, order: body.order || {} } };
}

// ═══════════════════════════════════════════════════════════
// OUTGOING HANDLER
// ═══════════════════════════════════════════════════════════

async function handleOutgoingRequest(action, request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const domain = body.domain || env.ONDC_DOMAIN || 'ONDC:RET11'; 
  
  const payload = buildPayload(action, domain, body, env);
  
  let authHeader;
  try {
    authHeader = await generateOndcSignature(payload, env);
  } catch (error) {
    return jsonResponse({ error: "Signature Error: " + error.message }, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, 500);
  }
  
  const gatewayUrl = env.ONDC_GATEWAY_URL || 'https://preprod.gateway.ondc.org';
  const workbenchUrl = `${gatewayUrl}/${action}`;
  
  try {
    const response = await fetch(workbenchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json().catch(() => ({}));
    
    // 📊 Observability: Request + Response दोनों push करें
    if (ctx && ctx.waitUntil) {
      // Request push: type = action (e.g., "init"), context + message from payload
      ctx.waitUntil(pushToObservability(action, payload.context, payload.message, env));
      
      // Response push: type = action + "_response" (e.g., "init_response"), 
      // context वही payload.context से, message response data से
      const responseMessage = data?.message || { ack: { status: 'NACK' } };
      ctx.waitUntil(pushToObservability(action + '_response', payload.context, responseMessage, env));
    }
    
    return jsonResponse({ 
      success: true, 
      action: action,
      domain: domain,
      transaction_id: payload.context.transaction_id,
      workbenchResponse: data, 
      sentPayload: payload 
    }, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });

  } catch (error) {
    return jsonResponse({ error: "Fetch Error: " + error.message }, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, 500);
  }
}

// ═══════════════════════════════════════════════════════════
// INCOMING WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════

async function handleIncomingWebhook(path, request, env, ctx) {
  const body = await request.json();
  // 👇 FIX: on_init, on_confirm, on_status - पूरा action name रखें
  const action = path.replace('/', '');  // "on_init", "on_confirm", etc.
  const txnId = body.context?.transaction_id;
  
  console.log(`📥 [WEBHOOK] ${action} received for TXN: ${txnId}`);

  if (action === 'on_search' && txnId && env.ONDC_DATA) {
    try {
      await env.ONDC_DATA.put(`txn_${txnId}`, JSON.stringify(body), { expirationTtl: 900 }); 
      console.log(`✅ Saved on_search data to KV for TXN: ${txnId}`);
    } catch (err) {
      console.error(`❌ Failed to save to KV:`, err.message);
    }
  }

  // 📊 Observability
  if (ctx && ctx.waitUntil) {
    // on_XXX request push: type = "on_init", context + message from body
    ctx.waitUntil(pushToObservability(action, body.context, body.message, env));
    
    // on_XXX_response push: type = "on_init_response", context same, message = our ACK
    ctx.waitUntil(pushToObservability(action + '_response', body.context, { ack: { status: 'ACK' } }, env));
  }

  return jsonResponse({ message: { ack: { status: 'ACK' } } }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// GET RESULTS HANDLER
// ═══════════════════════════════════════════════════════════

async function handleGetResults(txnId, env, corsHeaders) {
  if (!txnId || !env.ONDC_DATA) {
    return jsonResponse({ success: false, message: 'Invalid request or Database not configured' }, corsHeaders);
  }
  try {
    const data = await env.ONDC_DATA.get(`txn_${txnId}`);
    if (data) {
      return jsonResponse({ success: true, status: 'ready', results: JSON.parse(data) }, corsHeaders);
    } else {
      return jsonResponse({ success: false, status: 'pending', message: 'Data not ready yet' }, corsHeaders);
    }
  } catch (err) {
    return jsonResponse({ success: false, message: err.message }, corsHeaders, 500);
  }
}

// ═══════════════════════════════════════════════════════════
// BLAKE2b-512 Implementation
// ═══════════════════════════════════════════════════════════

const BLAKE2B_IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85,
  0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c,
  0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19
]);

const BLAKE2B_SIGMA = [
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
  [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],
  [11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],
  [7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],
  [9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],
  [2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],
  [12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],
  [13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],
  [6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],
  [10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
  [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3]
];

function rotr64(x, n) { return (x >>> n) | (x << (32 - n)); }

function blake2b512(input) {
  const inputBytes = new Uint8Array(input);
  const out = new Uint8Array(64);
  const h = new Uint32Array(BLAKE2B_IV);
  h[0] ^= 0x01010040;
  const blockBytes = 128;
  let t = 0;
  let pos = 0;
  const m = new Uint32Array(32);
  const v = new Uint32Array(32);

  function compress(last) {
    for (let i = 0; i < 16; i++) { v[i] = h[i]; v[i + 16] = BLAKE2B_IV[i]; }
    v[24] ^= t & 0xffffffff;
    v[25] ^= Math.floor(t / 0x100000000) & 0xffffffff;
    if (last) v[28] = ~v[28];

    for (let r = 0; r < 12; r++) {
      const s = BLAKE2B_SIGMA[r];
      const G = (a, b, c, d, x, y) => {
        v[a] = (v[a] + v[b] + x) | 0;
        v[d] = rotr64(v[d] ^ v[a], 16);
        v[c] = (v[c] + v[d]) | 0;
        v[b] = rotr64(v[b] ^ v[c], 12);
        v[a] = (v[a] + v[b] + y) | 0;
        v[d] = rotr64(v[d] ^ v[a], 8);
        v[c] = (v[c] + v[d]) | 0;
        v[b] = rotr64(v[b] ^ v[c], 7);
      };
      G(0,4,8,12, m[s[0]], m[s[1]]); G(1,5,9,13, m[s[2]], m[s[3]]);
      G(2,6,10,14, m[s[4]], m[s[5]]); G(3,7,11,15, m[s[6]], m[s[7]]);
      G(0,5,10,15, m[s[8]], m[s[9]]); G(1,6,11,12, m[s[10]], m[s[11]]);
      G(2,7,8,13, m[s[12]], m[s[13]]); G(3,4,9,14, m[s[14]], m[s[15]]);
    }
    for (let i = 0; i < 16; i++) h[i] ^= v[i] ^ v[i + 16];
  }

  while (pos < inputBytes.length) {
    const remaining = inputBytes.length - pos;
    const blockLen = Math.min(blockBytes, remaining);
    for (let i = 0; i < 32; i++) m[i] = 0;
    for (let i = 0; i < blockLen; i++) {
      m[i >> 2] |= inputBytes[pos + i] << ((i & 3) * 8);
    }
    t += blockLen;
    pos += blockLen;
    compress(pos >= inputBytes.length);
  }

  for (let i = 0; i < 16; i++) {
    out[i*4] = h[i] & 0xff;
    out[i*4+1] = (h[i] >>> 8) & 0xff;
    out[i*4+2] = (h[i] >>> 16) & 0xff;
    out[i*4+3] = (h[i] >>> 24) & 0xff;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// 📊 NETWORK OBSERVABILITY - Fixed Version
// ═══════════════════════════════════════════════════════════

function anonymizePayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sensitiveKeys = ['name', 'phone', 'email', 'building', 'locality', 'person'];
  const result = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    if (sensitiveKeys.includes(key.toLowerCase()) && typeof obj[key] === 'string') {
      result[key] = '****';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      result[key] = anonymizePayload(obj[key]);
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}

// 👇 नया pushToObservability — direct context + message लेता है
async function pushToObservability(action, context, message, env) {
  if (!env.ONDC_NO_TOKEN) {
    console.log("⚠️ [NO] Token not configured");
    return;
  }

  try {
    // अगर context ही खाली है, तो push मत करो
    if (!context || Object.keys(context).length === 0) {
      console.log(`⚠️ [NO] Skipping ${action} - empty context`);
      return;
    }

    const anonymizedContext = anonymizePayload(context);
    const anonymizedMessage = anonymizePayload(message || {});

    const logPayload = {
      type: action,
      data: {
        context: anonymizedContext,
        message: anonymizedMessage
      }
    };

    const noEndpoint = 'https://analytics-api-pre-prod.aws.ondc.org/v1/api/push-txn-logs';

    const response = await fetch(noEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.ONDC_NO_TOKEN}`
      },
      body: JSON.stringify(logPayload)
    });

    const resultText = await response.text();
    console.log(`📊 [NO] Pushed ${action} - Status: ${response.status} - Response: ${resultText.substring(0, 200)}`);

  } catch (err) {
    console.error(`❌ [NO] Failed to push ${action}:`, err.message);
  }
}

console.log('✅ NnlGharPro ONDC Universal API (Secure + KV) v5.2 loaded');
