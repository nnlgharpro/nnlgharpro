// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — Universal (With Signature)
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
          version: '3.1.0',
          timestamp: new Date().toISOString()
        }, corsHeaders);
      }
      
      const outgoingActions = ['search', 'select', 'init', 'confirm', 'status', 'cancel', 'update', 'track', 'support', 'rating'];
      const action = path.replace('/', '');
      
      if (outgoingActions.includes(action)) {
        return await handleOutgoingRequest(action, request, env);
      }
      
      if (path.startsWith('/on_')) {
        return await handleIncomingWebhook(path, request, env);
      }
      
      return jsonResponse({ error: 'Not found', path: path }, corsHeaders, 404);
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      return jsonResponse({ error: error.message, path: path }, corsHeaders, 500);
    }
  }
};

// ═══════════════════════════════════════════════════════════
// 🔧 HELPERS
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
// 🔐 SIGNATURE GENERATOR (ONDC Authorization Header)
// ═══════════════════════════════════════════════════════════

async function generateOndcSignature(body, env) {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 3600; // 1 घंटे के लिए valid

  // 1. Body का SHA-256 Digest बनाएँ
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(body));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const digest = btoa(String.fromCharCode(...hashArray));

  // 2. Signing String बनाएँ
  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: SHA-256=${digest}`;

  // 3. Private Key को Import करें (Ed25519)
  // ध्यान दें: ONDC_SIGNING_PRIVATE_KEY base64 format में होनी चाहिए
// 3. Private Key को Import करें (Ed25519) - Universal Fix v3
let rawKey = env.ONDC_SIGNING_PRIVATE_KEY || "";

// 1. सफाई: quotes, spaces, newlines हटाएँ
rawKey = rawKey.replace(/['"]/g, '').replace(/\\n/g, '').replace(/\s/g, '');

// 2. URL-safe Base64 को सामान्य Base64 में बदलें (- को +, _ को /)
rawKey = rawKey.replace(/-/g, '+').replace(/_/g, '/');

// 3. Base64 Padding (=) जोड़ें अगर मिसिंग है
while (rawKey.length % 4) {
    rawKey += '=';
}

console.log("🔑 DEBUG - Key Length:", rawKey.length);
let binaryDer;
const rawBinary = Uint8Array.from(atob(rawKey), c => c.charCodeAt(0));

// Format A: Agar key 32 bytes ki hai (Raw Ed25519 Key)
if (rawBinary.length === 32) {
    // PKCS8 Header for Ed25519 (302e020100300506032b657004220420)
    const pkcs8Prefix = new Uint8Array([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 
        0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 
        0x04, 0x20
    ]);
    binaryDer = new Uint8Array(pkcs8Prefix.length + rawBinary.length);
    binaryDer.set(pkcs8Prefix);
    binaryDer.set(rawBinary, pkcs8Prefix.length);
} else {
    // Format B: Agar pehle se hi PKCS8 DER format hai (MC4CAQAw...)
    binaryDer = rawBinary;
}

// 4. Debug: DER के पहले 10 बाइट्स देखें
const firstBytes = Array.from(binaryDer.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ');
console.log("🔑 DEBUG - DER First 10 Bytes:", firstBytes);

const privateKey = await crypto.subtle.importKey(
  "pkcs8",
  binaryDer.buffer,
  { name: "Ed25519" },
  false,
  ["sign"]
);
  // 4. Signature बनाएँ
  const signatureBuffer = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    encoder.encode(signingString)
  );
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const signature = btoa(String.fromCharCode(...signatureArray));

  // 5. Authorization Header Format तैयार करें
  const ukId = env.ONDC_UK_ID || "1"; // ONDC keys file mein aksar ukId "1" hota hai
  const keyId = `${env.ONDC_BAP_ID}|${ukId}|ed25519`; 
  
  return `Signature keyId="${keyId}",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

// ═══════════════════════════════════════════════════════════
// 🧠 UNIVERSAL PAYLOAD BUILDER
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
            fulfillment: { type: 'SERVICE' },
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
            fulfillment: { type: 'Delivery' },
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
// 📤 OUTGOING HANDLER (With Signature Integration)
// ═══════════════════════════════════════════════════════════

async function handleOutgoingRequest(action, request, env) {
  const body = await request.json().catch(() => ({}));
  const domain = body.domain || env.ONDC_DOMAIN || 'ONDC:RET11'; 
  
  const payload = buildPayload(action, domain, body, env);
  
  // 🔐 Signature बनाएँ
  const authHeader = await generateOndcSignature(payload, env);
  
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${domain}/1.2.5/seller/${action}`;
  
  const response = await fetch(workbenchUrl, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': authHeader // 👈 Signature लगा दिया
    },
    body: JSON.stringify(payload)
  });
  
  const data = await response.json().catch(() => ({}));
  
  return jsonResponse({ 
    success: true, 
    action: action,
    domain: domain,
    workbenchResponse: data, 
    sentPayload: payload 
  }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📥 INCOMING WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════

async function handleIncomingWebhook(path, request, env) {
  const body = await request.json();
  const action = path.replace('/on_', '');
  
  console.log(`📥 [WEBHOOK] on_${action} received for TXN: ${body.context?.transaction_id}`);

  return jsonResponse({
    message: { ack: { status: 'ACK' } }
  }, { 'Content-Type': 'application/json' });
}

console.log('✅ NnlGharPro ONDC Universal API (Secure) loaded');
