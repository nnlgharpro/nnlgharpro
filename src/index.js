// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — Universal (With KV & Signature) - v6.2 (Schema Fix)
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
        return jsonResponse({
          status: 'active',
          service: 'NnlGharPro ONDC Universal API (TweetNaCl)',
          version: '6.2.0',
          timestamp: new Date().toISOString()
        }, corsHeaders);
      }
      
      // Registry Lookup (Test Endpoint)
      if (path === '/registry-lookup') {
        const bapId = env.ONDC_BAP_ID || "nnlgharpro-ret11.nnlgharpro.workers.dev";
        const lookupBody = {
          subscriber_id: bapId,
          domain: env.ONDC_DOMAIN || "ONDC:RET11"
        };
        
        console.log("🔍 Registry Lookup Body:", JSON.stringify(lookupBody));

        try {
          const authHeader = await generateOndcSignature(lookupBody, env);
          console.log("🔐 Generated Auth Header:", authHeader);

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
      
      // Outgoing Actions
      const outgoingActions = ['search', 'select', 'init', 'confirm', 'status', 'cancel', 'update', 'track', 'support', 'rating'];
      const action = path.replace('/', '');
      
      if (outgoingActions.includes(action)) {
        return await handleOutgoingRequest(action, request, env, ctx);
      }
      
      // Get Results
      if (path.startsWith('/get-results/')) {
        const txnId = path.split('/')[2];
        return await handleGetResults(txnId, env, corsHeaders);
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
// SIGNATURE GENERATOR (FIXED WITH TWEETNACL)
// ═══════════════════════════════════════════════════════════

async function generateOndcSignature(body, env) {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 3600;

  const encoder = new TextEncoder();
  
  // 1. BLAKE2b-512 hash generate karein (blakejs se)
  const data = encoder.encode(JSON.stringify(body));
  const hashBuffer = blake2b(data, null, 64);
  const digest = btoa(String.fromCharCode(...hashBuffer));

  // 2. Exact ONDC Signing string format
  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

  // 3. Private Key ko clean aur decode karein
  let rawKey = env.ONDC_SIGNING_PRIVATE_KEY || "";
  rawKey = rawKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  rawKey = rawKey.replace(/-/g, '+').replace(/_/g, '/');
  while (rawKey.length % 4) { rawKey += '='; }
  
  const privateKeyBytes = Uint8Array.from(atob(rawKey), c => c.charCodeAt(0));

  // 4. TweetNaCl ke liye Secret Key tayar karein (64 bytes required)
  let secretKey = privateKeyBytes;
  if (privateKeyBytes.length === 32) {
      secretKey = nacl.sign.keyPair.fromSeed(privateKeyBytes).secretKey;
  } else if (privateKeyBytes.length !== 64) {
      throw new Error(`Invalid private key length: ${privateKeyBytes.length}. Must be 32 (seed) or 64 (full key) bytes.`);
  }

  // 5. Signature generate karein (TweetNaCl se)
  const messageBytes = encoder.encode(signingString);
  const signatureBytes = nacl.sign.detached(messageBytes, secretKey);
  const signature = btoa(String.fromCharCode(...signatureBytes));

  // 6. Authorization Header format karein
  const ukId = env.ONDC_UK_ID;
  const keyId = `${env.ONDC_BAP_ID}|${ukId}|ed25519`; 
  
  return `Signature keyId="${keyId}",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

// ═══════════════════════════════════════════════════════════
// PAYLOAD BUILDER (SCHEMA FIXED)
// ═══════════════════════════════════════════════════════════

function buildPayload(action, domain, body, env) {
  // 📍 Pincode to City Code mapping (Required for ONDC Context)
  let cityCode = "std:011"; 
  if (body.pincode === "123001") cityCode = "std:01282";

  const context = {
    domain: domain,
    action: action,
    version: '1.2.5',
    bap_id: env.ONDC_BAP_ID,
    bap_uri: env.ONDC_BAP_URI,
    transaction_id: body.transactionId || generateUUID(),
    message_id: generateUUID(),
    timestamp: getTimestamp(),
    ttl: 'PT30S',
    location: {
      city: { code: cityCode },
      country: { code: "IND" }
    }
  };

  if (domain.startsWith('ONDC:SRV')) {
    if (action === 'search') {
      return {
        context,
        message: {
          intent: {
            item: { descriptor: { name: body.query || 'Plumber' } },
            fulfillment: { type: 'SERVICE' }
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
          fulfillment: { type: 'SERVICE' },
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
            // ✅ FIX: fulfillment mein end aur payment hata diya gaya hai
            fulfillment: { type: 'Delivery' }
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
          fulfillment: { type: 'Delivery' },
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
    
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(pushToObservability(action, payload.context, payload.message, env));
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
  const action = path.replace('/', '');
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

  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(pushToObservability(action, body.context, body.message, env));
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
// 📊 NETWORK OBSERVABILITY
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

async function pushToObservability(action, context, message, env) {
  if (!env.ONDC_NO_TOKEN) {
    return;
  }

  try {
    if (!context || Object.keys(context).length === 0) {
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
    console.log(`📊 [NO] Pushed ${action} - Status: ${response.status}`);

  } catch (err) {
    console.error(`❌ [NO] Failed to push ${action}:`, err.message);
  }
}

console.log('✅ NnlGharPro ONDC Universal API (TweetNaCl Edition) v6.2 loaded');
