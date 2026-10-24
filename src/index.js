// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — DEBUGGING MODE (v12.6)
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
        return jsonResponse({ status: 'active', version: '12.6.0', role: 'Absolute_Matcher' }, corsHeaders);
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

      // 🚨 1. GATEWAY INCOMING CALLBACKS
      if (path === 'on_search' || path === 'on_select' || path === 'on_init' || path === 'on_confirm' || path.startsWith('on_')) {
        const body = await request.json();
        const txnId = body.context?.transaction_id;
        const action = body.context?.action;
        const domain = body.context?.domain || "ONDC:RET11";

        if (env.ONDC_DATA && txnId) {
            await env.ONDC_DATA.put(`bap_callback_${action}_${txnId}`, JSON.stringify(body), { expirationTtl: 900 });
        }

        // 🎯 SPECIFIC HANDLING FOR on_update
        if (action === 'on_update' && txnId) {
            const updatedOrder = body.message?.order;
            if (updatedOrder) {
                console.log(`[ON_UPDATE] Order ${updatedOrder.id} updated successfully.`);
                await env.ONDC_DATA.put(`order_${updatedOrder.id}_updated`, JSON.stringify(updatedOrder), { expirationTtl: 3600 });
            }
        }

        // 🔥 LIVE AUTO-PIPELINE TRIGGER (TEMPORARILY DISABLED FOR TESTING)
        /*
        if (action === 'on_search' && txnId) {
          ctx.waitUntil(
            (async () => {
              const nextActions = ['select', 'init', 'confirm', 'update'];
              
              for (const act of nextActions) {
                await new Promise(r => setTimeout(r, 1000));
                
                let testBody = {};
                if (act === 'update') {
                    testBody = {
                        orderId: "test_order_" + txnId.substring(0,8),
                        newBuilding: "Flat 402, Updated Building",
                        instructions: "Please ring the bell twice."
                    };
                }

                const autoPayload = buildBapPayload(act, domain, testBody, txnId, env);
                const autoAuth = await generateOndcSignature(autoPayload, env);
                
                await fetch(env.ONDC_GATEWAY_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Gateway-Authorization': autoAuth, 'Authorization': autoAuth },
                  body: JSON.stringify(autoPayload)
                }).then(res => res.text()).catch((e) => console.log(`Auto-Pipeline Error (${act}):`, e));
              }
            })()
          );
        }
        */

        return jsonResponse({ message: { ack: { status: "ACK" } } }, corsHeaders);
      }

      // 🚨 2. FRONTEND OUTGOING
      if (path.startsWith('client_')) {
        const action = path.replace('client_', '');
        const reqBody = await request.json();
        const transactionId = reqBody.transactionId || crypto.randomUUID();
        const domain = env.ONDC_DOMAIN || "ONDC:RET11";
        
        const payload = buildBapPayload(action, domain, reqBody, transactionId, env);
        const authHeader = await generateOndcSignature(payload, env);
        
        // ✅ LOGGING ENABLED
        ctx.waitUntil(
          fetch(env.ONDC_GATEWAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Gateway-Authorization': authHeader, 'Authorization': authHeader },
            body: JSON.stringify(payload)
          })
          .then(async (res) => {
            const text = await res.text();
            console.log(`[CLIENT_${action.toUpperCase()}] Gateway Response Status:`, res.status);
            console.log(`[CLIENT_${action.toUpperCase()}] Gateway Response Body:`, text);
          })
          .catch((e) => console.log(`[CLIENT_${action.toUpperCase()}] Fetch Error:`, e.message))
        );

        return jsonResponse({ 
            success: true, 
            status: 'ready', 
            transactionId: transactionId,
            results: mockProviders,
            providers: mockProviders,
            message: { catalog: { "bpp/providers": mockProviders } }
        }, corsHeaders);
      }
      
      if (path.startsWith('get-results/')) {
        return jsonResponse({ success: true, status: 'ready', results: mockProviders, providers: mockProviders }, corsHeaders);
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
  const timestamp = new Date().toISOString();
  return {
    context: {
      domain, country: "IND", city: "std:011", action, core_version: '1.2.5',
      bap_id: env.ONDC_BAP_ID, bap_uri: env.ONDC_BAP_URI,
      transaction_id: transactionId, message_id: crypto.randomUUID(), timestamp: timestamp, ttl: 'PT30S'
    },
    message: action === 'search' ? {
      intent: {
        item: { descriptor: { name: "Food" } },
        fulfillment: { type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: body.pincode || "110001" } } } },
        tags: [
          {
            code: "BAP_TERMS",
            list: [
              { code: "STATIC_SIGNATURE_REQ", value: "true" },
              { code: "FINDER_FEE_TYPE", value: "percent" },
              { code: "FINDER_FEE_AMOUNT", value: "3.0" }
            ]
          }
        ]
      }
    } : action === 'select' ? {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ id: "item_veg_thali", quantity: { count: 1 } }],
        billing: {
          name: body.name || "Test User",
          address: {
            name: body.name || "Test User",
            building: body.address || "Main Road",
            locality: "Test Locality",
            city: "Delhi",
            state: "Delhi",
            country: "IND",
            area_code: body.pincode || "110001"
          },
          phone: body.phone || "9876543210",
          email: body.email || "test@nnlgharpro.com"
        },
        fulfillments: [{
          id: "F1",
          type: "Delivery",
          end: {
            location: {
              gps: "28.6139,77.2090",
              address: {
                name: body.name || "Test User",
                building: body.address || "Main Road",
                locality: "Test Locality",
                city: "Delhi",
                state: "Delhi",
                country: "IND",
                area_code: body.pincode || "110001"
              }
            },
            contact: {
              phone: body.phone || "9876543210",
              email: body.email || "test@nnlgharpro.com"
            }
          }
        }]
      }
    } : action === 'init' ? {
      order: {
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ id: "item_veg_thali", quantity: { count: 1 } }],
        billing: { name: "Test User", address: { name: "Test User", building: "Main Road", city: "Delhi", state: "Delhi", country: "IND", area_code: "110001" }, phone: "9876543210", email: "test@nnlgharpro.com" },
        fulfillments: [{ id: "F1", type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } } } }]
      }
    } : action === 'confirm' ? {
      order: {
        id: crypto.randomUUID(), state: "Created",
        provider: { id: "provider_workbench_1", locations: [{ id: "L1" }] },
        items: [{ id: "item_veg_thali", quantity: { count: 1 } }],
        billing: { name: "Test User", phone: "9876543210", address: { building: "Main Road", city: "Delhi", area_code: "110001" } },
        fulfillments: [{ id: "F1", type: "Delivery", end: { location: { gps: "28.6139,77.2090", address: { area_code: "110001" } } } }],
        payment: { uri: "https://razorpay.com", tls_method: "string", status: "PAID", type: "ON-ORDER", collected_by: "BAP" }
      }
    } : action === 'update' ? {
      order: {
        id: body.orderId || "YOUR_EXISTING_ORDER_ID", 
        fulfillments: [{
          id: "F1",
          type: "Delivery",
          end: {
            location: {
              gps: body.newGps || "28.6139,77.2090",
              address: {
                name: body.newName || "Test User",
                building: body.newBuilding || "New Building, Flat 402",
                locality: body.newLocality || "New Locality",
                city: body.newCity || "Delhi",
                state: body.newState || "Delhi",
                country: "IND",
                area_code: body.newAreaCode || "110001"
              }
            },
            instructions: {
              name: "delivery_instructions",
              short_desc: body.instructions || "Please ring the bell twice."
            }
          }
        }]
      }
    } : {}
  };
}
