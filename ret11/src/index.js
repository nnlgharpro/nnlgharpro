// ═══════════════════════════════════════════════════════════
// 🍔 NNLGHARPRO ONDC API — Food & Beverage (RET11)
// WITH ED25519 SIGNING
// ═══════════════════════════════════════════════════════════

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const DOMAIN = 'ONDC:RET11';
const VERSION = '1.2.5';
const BAP_ID = 'nnlgharpro-ret11.nnlgharpro.workers.dev';
const BAP_URI = 'https://nnlgharpro-ret11.nnlgharpro.workers.dev';

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
    
    try {
      if (path === '/' || path === '/api/health') {
        return jsonResponse({
          status: 'active',
          service: 'NnlGharPro ONDC API',
          domain: DOMAIN,
          version: VERSION,
          signing_configured: !!env.signing_private_key,
          keys_check: {
            signing_private_key: !!env.signing_private_key,
            signing_public_key: !!env.signing_public_key,
            ukid: !!env.ukid,
            subscriber_id: !!env.subscriber_id,
            subscriber_url: !!env.subscriber_url,
            ondc_domains: !!env.ondc_domains
          },
          timestamp: new Date().toISOString()
        }, corsHeaders);
      }
      
      if (path === '/search')  return await handleSearch(request, env);
      if (path === '/select')  return await handleSelect(request, env);
      if (path === '/init')    return await handleInit(request, env);
      if (path === '/confirm') return await handleConfirm(request, env);
      
      if (path === '/on_search')  return await handleAck();
      if (path === '/on_select')  return await handleAck();
      if (path === '/on_init')    return await handleAck();
      if (path === '/on_confirm') return await handleAck();
      if (path === '/on_status')  return await handleAck();
      if (path === '/on_update')  return await handleAck();
      
      return jsonResponse({ error: 'Not found', path: path }, corsHeaders, 404);
    } catch (error) {
      return jsonResponse({ error: error.message, path: path }, corsHeaders, 500);
    }
  }
};

// ═══════════════════════════════════════════════════════════
// 🔐 ED25519 SIGNING FUNCTION
// ═══════════════════════════════════════════════════════════

function createAuthHeader(payload, env) {
  // Check private key
  if (!env.signing_private_key) {
    console.error('❌ signing_private_key missing in env');
    return null;
  }
  
  try {
    // 1. Payload ko JSON string banao
    const message = JSON.stringify(payload);
    
    // 2. Private key decode karo (base64 → Uint8Array)
    let secretKey;
    try {
      secretKey = util.decodeBase64(env.signing_private_key);
    } catch (e) {
      console.error('❌ Private key base64 decode failed:', e.message);
      // Try hex decode
      try {
        const hexMatch = env.signing_private_key.match(/.{1,2}/g);
        secretKey = new Uint8Array(hexMatch.map(byte => parseInt(byte, 16)));
      } catch (e2) {
        console.error('❌ Private key hex decode failed:', e2.message);
        return null;
      }
    }
    
    // 3. Ed25519 private key 64 bytes honi chahiye (32 secret + 32 public)
    if (secretKey.length !== 64) {
      console.warn('⚠️ Secret key length:', secretKey.length, 'expected 64');
      // Agar 32 hai, to expand karo
      if (secretKey.length === 32) {
        const keyPair = nacl.sign.keyPair.fromSeed(secretKey);
        secretKey = keyPair.secretKey;
      }
    }
    
    // 4. Message ko bytes mein convert karo
    const messageBytes = util.decodeUTF8(message);
    
    // 5. Ed25519 signature generate karo
    const signature = nacl.sign.detached(messageBytes, secretKey);
    
    // 6. Base64 encode karo
    const signatureBase64 = util.encodeBase64(signature);
    
    // 7. Unique Key ID (ukid)
    const ukid = env.ukid || 'key-1';
    
    // 8. ONDC Auth header format
    const authHeader = `Signature keyId="${BAP_ID}|${ukid}|ed25519",algorithm="ed25519",created="${Math.floor(Date.now()/1000)}",signature="${signatureBase64}"`;
    
    console.log('✅ Signature generated, length:', signatureBase64.length);
    return authHeader;
    
  } catch (e) {
    console.error('❌ Signing failed:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 🔧 HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

function generateUUID() { return crypto.randomUUID(); }
function getTimestamp() { return new Date().toISOString(); }

async function handleAck() {
  return jsonResponse({ message: { ack: { status: 'ACK' } } }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📤 /search — WITH SIGNING
// ═══════════════════════════════════════════════════════════

async function handleSearch(request, env) {
  const body = await request.json().catch(() => ({}));
  
  const payload = {
    context: {
      domain: DOMAIN, action: 'search', version: VERSION,
      bap_id: BAP_ID, bap_uri: BAP_URI,
      transaction_id: generateUUID(), message_id: generateUUID(),
      timestamp: getTimestamp(), ttl: 'PT30S'
    },
    message: {
      intent: {
        category: { descriptor: { name: body.category || 'Food' } },
        fulfillment: { type: 'Delivery' },
        payment: {
          '@ondc/org/buyer_app_finder_fee_type': 'percent',
          '@ondc/org/buyer_app_finder_fee_amount': '3'
        }
      }
    }
  };
  
  const authHeader = createAuthHeader(payload, env);
  
  const headers = { 'Content-Type': 'application/json' };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${DOMAIN}/${VERSION}/seller/search`;
  const response = await fetch(workbenchUrl, {
    method: 'POST', headers: headers,
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  
  return jsonResponse({
    success: true,
    transactionId: payload.context.transaction_id,
    authHeaderSent: authHeader ? authHeader.substring(0, 150) + '...' : 'NONE',
    workbenchResponse: data,
    sentPayload: payload
  }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📤 /select — WITH SIGNING
// ═══════════════════════════════════════════════════════════

async function handleSelect(request, env) {
  const body = await request.json().catch(() => ({}));
  const payload = {
    context: {
      domain: DOMAIN, action: 'select', version: VERSION,
      bap_id: BAP_ID, bap_uri: BAP_URI,
      transaction_id: body.transactionId || generateUUID(),
      message_id: generateUUID(), timestamp: getTimestamp(), ttl: 'PT30S'
    },
    message: {
      order: {
        provider: { id: body.providerId || 'provider_1' },
        items: body.items || [{ id: 'item_1', quantity: { count: 1 } }],
        fulfillment: { type: 'Delivery', end: { location: { gps: '28.0444,76.1084', address: { area_code: '123001' } } } }
      }
    }
  };
  
  const authHeader = createAuthHeader(payload, env);
  const headers = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${DOMAIN}/${VERSION}/seller/select`;
  const response = await fetch(workbenchUrl, {
    method: 'POST', headers: headers, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return jsonResponse({ success: true, workbenchResponse: data, sentPayload: payload }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📤 /init — WITH SIGNING
// ═══════════════════════════════════════════════════════════

async function handleInit(request, env) {
  const body = await request.json().catch(() => ({}));
  const payload = {
    context: {
      domain: DOMAIN, action: 'init', version: VERSION,
      bap_id: BAP_ID, bap_uri: BAP_URI,
      transaction_id: body.transactionId || generateUUID(),
      message_id: generateUUID(), timestamp: getTimestamp(), ttl: 'PT30S'
    },
    message: {
      order: {
        provider: { id: body.providerId || 'provider_1' },
        items: body.items || [{ id: 'item_1', quantity: { count: 1 } }],
        billing: body.billing || {
          name: 'Customer', phone: '9588562553',
          address: { city: 'Narnaul', state: 'Haryana', country: 'IND', area_code: '123001' }
        },
        fulfillment: { type: 'Delivery', end: { location: { gps: '28.0444,76.1084', address: { area_code: '123001' } }, contact: { phone: '9588562553' } } }
      }
    }
  };
  
  const authHeader = createAuthHeader(payload, env);
  const headers = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${DOMAIN}/${VERSION}/seller/init`;
  const response = await fetch(workbenchUrl, {
    method: 'POST', headers: headers, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return jsonResponse({ success: true, workbenchResponse: data, sentPayload: payload }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📤 /confirm — WITH SIGNING
// ═══════════════════════════════════════════════════════════

async function handleConfirm(request, env) {
  const body = await request.json().catch(() => ({}));
  const payload = {
    context: {
      domain: DOMAIN, action: 'confirm', version: VERSION,
      bap_id: BAP_ID, bap_uri: BAP_URI,
      transaction_id: body.transactionId || generateUUID(),
      message_id: generateUUID(), timestamp: getTimestamp(), ttl: 'PT30S'
    },
    message: {
      order: body.order || {
        provider: { id: 'provider_1' },
        items: [{ id: 'item_1', quantity: { count: 1 } }],
        payment: { type: 'ON-FULFILLMENT', status: 'PAID', collected_by: 'BAP' }
      }
    }
  };
  
  const authHeader = createAuthHeader(payload, env);
  const headers = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${DOMAIN}/${VERSION}/seller/confirm`;
  const response = await fetch(workbenchUrl, {
    method: 'POST', headers: headers, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return jsonResponse({ success: true, workbenchResponse: data, sentPayload: payload }, { 'Content-Type': 'application/json' });
}

console.log(`✅ NnlGharPro ONDC API (${DOMAIN}) loaded — WITH ED25519 SIGNING`);
