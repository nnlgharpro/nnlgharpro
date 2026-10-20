// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — UNIVERSAL MASTER v9.8.6 (Fixed Architecture)
// ═══════════════════════════════════════════════════════════

import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // पाथ के आगे और पीछे से स्लैश (/) हटाएं ताकि राउटिंग सही हो
    const path = url.pathname.replace(/^\/+|\/+\$/g, ''); 
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gateway-Authorization',
    };
    
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    
    try {
      // हेल्थ चेक एंडपॉइंट
      if (path === '' || path === 'api/health') {
        return jsonResponse({ status: 'active', version: '9.8.6', description: 'Universal ONDC Master Node' }, corsHeaders);
      }
      
      // 🚨 1. FRONTEND OUTGOING (जब आपका फ़्रंटएंड सर्च, सेलेक्ट, इनिट या कन्फर्म ट्रिगर करे)
      if (path.startsWith('client_')) {
        const action = path.replace('client_', '');
        const reqBody = await request.json();
        
        // फ़्रंटएंड से भेजी गई transactionId लें या नई जनरेट करें
        const transactionId = reqBody.transactionId || crypto.randomUUID();
        const domain = env.ONDC_DOMAIN || "ONDC:RET11"; // wrangler.toml से डोमेन रीड करेगा
        
        const payload = buildBapPayload(action, domain, reqBody, transactionId, env);
        const authHeader = await generateOndcSignature(payload, env);

        // बैकग्राउंड में बिना फ़्रंटएंड को अटकाए ONDC Workbench Gateway को रिक्वेस्ट भेजें
        ctx.waitUntil(
          fetch(env.ONDC_GATEWAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
            body: JSON.stringify(payload)
          }).then(res => res.text()).then(text => console.log("Gateway Response:", text)).catch(e => console.error("Gateway Error:", e))
        );

        // 👍 फ़्रंटएंड को तुरंत transactionId भेजें ताकि 'undefined' की एरर कभी न आए
        return jsonResponse({ success: true, transactionId: transactionId, status: "initiated" }, corsHeaders);
      }
      
      // 🚨 2. GATEWAY INCOMING CALLBACKS (जब वर्कबेंच का कैटलॉग वर्कर पर वापस आए - जैसे on_search)
      if (path.startsWith('on_')) {
        const body = await request.json();
        const txnId = body.context?.transaction_id;
        
        if (env.ONDC_DATA && txnId) {
            // कैटलॉग डेटा को KV स्टोरेज में 'bap_callback_on_search_YOUR_ID' नाम से सुरक्षित रखें
            await env.ONDC_DATA.put(`bap_callback_${path}_${txnId}`, JSON.stringify(body), { expirationTtl: 900 });
        }
        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }
      
      // 🚨 3. FRONTEND POLLING (फ़्रंटएंड इसी एंडपॉइंट से बार-बार हिट मारकर डेटा चेक करता है)
      if (path.startsWith('get-results/')) {
        const parts = path.split('/');
        const txnId = parts[1]; // यूआरएल से असली ID निकालें
        
        if (!txnId || txnId === 'undefined') {
          return jsonResponse({ success: false, status: 'error', message: 'Invalid or missing Transaction ID' }, corsHeaders);
        }
        
        let data = null;
        if (env.ONDC_DATA) {
            data = await env.ONDC_DATA.get(`bap_callback_on_search_${txnId}`);
        }
        
        // अगर KV डेटाबेस में ONDC नेटवर्क से कैटलॉग आ चुका है
        if (data) {
            const parsedData = JSON.parse(data);
            return jsonResponse({
                success: true,
                status: 'ready',
                results: parsedData.message?.catalog?.['bpp/providers'] || []
            }, corsHeaders);
        }
        
        // अगर अभी गेटवे से रिस्पॉन्स आना बाकी है, तो लोडिंग चालू रखें
        return jsonResponse({ success: true, status: 'searching', results: [] }, corsHeaders);
      }
      
      return jsonResponse({ error: 'Endpoint route not found' }, corsHeaders, 404);
    } catch (error) {
      return jsonResponse({ error: error.message }, corsHeaders, 500);
    }
  }
};

// ═══════════════════════════════════════════════════════════
// 🛠️ CRYPTOGRAPHIC CRYPTO ENGINE & BUILDERS
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

function buildBapPayload(action, domain, body, transactionId, env) {
  return {
    context: {
      domain, country: "IND", city: body.city || "std:011", action, core_version: '1.2.5',
      bap_id: env.ONDC_BAP_ID, bap_uri: env.ONDC_BAP_URI,
      transaction_id: transactionId,
      message_id: crypto.randomUUID(), timestamp: new Date().toISOString(), ttl: 'PT30S'
    },
    message: action === 'search' ? {
      intent: {
        item: { descriptor: { name: body.category || "Food" } },
        fulfillment: { type: "Delivery", end: { location: { gps: body.gps || "28.6139,77.2090", address: { area_code: body.pincode || "110001" } } } },
        payment: { "@ondc/org/buyer_app_finder_fee_type": "percent", "@ondc/org/buyer_app_finder_fee_amount": "3.0" }
      }
    } : {}
  };
}
