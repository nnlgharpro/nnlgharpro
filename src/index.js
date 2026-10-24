import { blake2b } from 'blakejs'; 
import nacl from 'tweetnacl'; 

const CORE_VERSION = "1.2.5";
const DEFAULT_CITY = "std:011"; 
const DEFAULT_COUNTRY = "IND";
const TTL_DURATION = "PT30S";

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
        return jsonResponse({ status: 'active', version: '21.0.0' }, corsHeaders);
      }
      
      const mockProviders = [{
          id: "provider_workbench_1",
          descriptor: { name: "NnlGharPro Test Kitchen" },
          locations: [{ id: "L1", gps: "28.6139,77.2090" }],
          items: [{
              id: "item_veg_thali",
              descriptor: { name: "Standard Veg Thali" },
              category_id: "RET11-Meals",
              fulfillment_id: "F1",
              location_id: "L1",
              price: { currency: "INR", value: "150.00" }
          }]
      }];

      // 1. GATEWAY CALLBACKS
      if (path.startsWith('on_')) {
        const body = await request.json();
        const txnId = body.context?.transaction_id;
        const action = body.context?.action;

        if (env.ONDC_DATA && txnId) {
            await env.ONDC_DATA.put(`bap_callback_${action}_${txnId}`, JSON.stringify(body), { expirationTtl: 900 });
        }
        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }

      // 2. OUTBOUND CLIENT
      if (path.startsWith('client_')) {
        const action = path.replace('client_', '');
        const reqBody = await request.json();
        
        const transactionId = reqBody.transactionId || crypto.randomUUID();
        const domain = reqBody.domain || env.ONDC_DOMAIN || "ONDC:RET11";
        
        const payload = buildBapPayload(action, domain, reqBody, transactionId, env);
        const authHeader = await generateOndcSignature(payload, env);
        
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

        ctx.waitUntil(
          fetch(gatewayUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'X-Gateway-Authorization': authHeader, 
                'Authorization': authHeader 
            },
            body: JSON.stringify(payload)
          })
          .then(async (res) => {
            console.log(`[CLIENT_${action.toUpperCase()}] Success: ${res.status}`);
          })
          .catch((e) => console.log(`[CLIENT_${action.toUpperCase()}] Error:`, e.message))
        );

        return jsonResponse({ success: true, transactionId, providers: mockProviders }, corsHeaders);
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
  let secretKey = privateKeyBytes.length === 32 ? nacl.sign.keyPair.fromSeed(privateKeyBytes).secretKey : privateKeyBytes;
  const signatureBytes = nacl.sign.detached(encoder.encode(signingString), secretKey);
  const signature = btoa(String.fromCharCode(...signatureBytes));
  
  return `Signature keyId="${env.ONDC_BAP_ID}|${env.ONDC_UK_ID}|ed25519",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
}

function buildBapPayload(action, domain, body, transactionId, env) {
  const timestamp = new Date().toISOString();
  
  const context = {
    domain: domain, 
    country: DEFAULT_COUNTRY, 
    city: DEFAULT_CITY, 
    action: action, 
    core_version: CORE_VERSION,
    bap_id: env.ONDC_BAP_ID, 
    bap_uri: env.ONDC_BAP_URI,
    bpp_id: "workbench.ondc.tech", 
    bpp_uri: "https://workbench.ondc.tech", // ✅ BINA SLASH KE
    transaction_id: transactionId, 
    message_id: crypto.randomUUID(), 
    timestamp: timestamp, 
    ttl: TTL_DURATION
  };

  const itemBlock = {
    id: "item_veg_thali",
    location_id: "L1",
    quantity: { count: 1 },
    tags: [{ code: "type", list: [{ code: "type", value: "item" }] }]
  };

  const providerBlock = { id: "provider_workbench_1", locations: [{ id: "L1" }] };

  const defaultBilling = { 
    name: "Test User", 
    address: { name: "Test User", building: "Main Road", locality: "Test", city: "Delhi", state: "Delhi", country: "IND", area_code: "110001" }, 
    phone: "9876543210", email: "test@test.com" 
  };

  const defaultFulfillment = { 
    id: "F1", type: "Delivery", 
    end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } }, contact: { phone: "9876543210" } } 
  };

  let message = {};

  if (action === 'search') {
    message = { intent: { item: { descriptor: { name: "Food" } }, fulfillment: { type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: body.pincode || "110001" } } } } } };
  } else if (action === 'select') {
    message = { order: { provider: providerBlock, items: [itemBlock] } };
  } else if (action === 'init') {
    message = { order: { provider: providerBlock, items: [itemBlock], billing: defaultBilling, fulfillments: [defaultFulfillment] } };
  } else if (action === 'confirm') {
    message = { order: { id: crypto.randomUUID(), state: "Created", provider: providerBlock, items: [itemBlock], billing: defaultBilling, fulfillments: [defaultFulfillment], payment: { type: "POST-FULFILLMENT", status: "NOT-PAID", collected_by: "BPP" } } };
  }

  return { context, message };
}
