// ONDC BAP worker (RET11 / Workbench) - FINAL FIX
import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

const TTL = 'PT30S';
const DEFAULT_CITY = 'std:011';
const DEFAULT_COUNTRY = 'IND';
const DEFAULT_GPS = '28.6139,77.2090';
const DEFAULT_PIN = '110001';
const ACTIONS = ['search', 'select', 'init', 'confirm'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gateway-Authorization',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, '');

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (path === '' || path === 'api/health') {
        return json({ status: 'active', domain: env.ONDC_DOMAIN, bap_id: env.ONDC_BAP_ID, has_private_key: !!getPrivateKey(env) });
      }

      // Callbacks
      if (path.startsWith('on_')) {
        let body = {};
        if (request.method === 'POST') {
          try { body = await request.json(); } catch (e) {}
        }
        console.log(`[CALLBACK ${path}]`, JSON.stringify(body).slice(0, 3000));
        ctx.waitUntil(saveCallback(path, body, env));
        return json({ message: { ack: { status: 'ACK' } } });
      }

      // Actions
      const action = path.startsWith('client_') ? path.replace('client_', '') : path;
      if (ACTIONS.includes(action)) {
        let body = {};
        if (request.method === 'POST') {
          try { body = await request.json(); } catch (e) {}
        }

        // Workbench ki ID use karein, agar na mile toh nayi banayein
        const transactionId = body.transaction_id || crypto.randomUUID();
        const messageId = body.message_id || crypto.randomUUID();
        const state = await loadState(transactionId, env);

        const payload = buildPayload(action, body, transactionId, messageId, state, env);
        const bodyString = JSON.stringify(payload);
        const authHeader = await signRequest(bodyString, env);
        
        // Gateway URL (Ensure ONDC_GATEWAY_URL ends with /seller)
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

        const res = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: bodyString,
        });
        
        const text = await res.text();
        console.log(`[${action.toUpperCase()}] Status: ${res.status} | Response: ${text}`);

        return json({
          success: res.ok,
          action,
          transaction_id: transactionId,
          message_id: messageId,
          gateway_status: res.status,
          gateway_response: safeParse(text),
          sent_payload: payload,
        }, res.ok ? 200 : 502);
      }

      return json({ error: 'Route not mapped' }, 404);
    } catch (error) {
      console.log('[ERROR]', error.message);
      return json({ error: error.message }, 500);
    }
  },
};

// ... (Helpers same rahenge: json, safeParse, getPrivateKey, b64ToBytes, bytesToB64, signRequest)

function buildPayload(action, body, transactionId, messageId, state, env) {
  const context = {
    domain: body.domain || env.ONDC_DOMAIN || 'ONDC:RET11',
    country: DEFAULT_COUNTRY,
    city: body.city || DEFAULT_CITY,
    action,
    core_version: env.ONDC_CORE_VERSION || '1.2.5',
    bap_id: env.ONDC_BAP_ID,
    bap_uri: env.ONDC_BAP_URI,
    transaction_id: transactionId,
    message_id: messageId,
    timestamp: new Date().toISOString(),
    ttl: TTL,
    bpp_id: body.bpp_id || state.bpp_id || env.ONDC_BPP_ID || 'workbench.ondc.tech',
    bpp_uri: body.bpp_uri || state.bpp_uri || env.ONDC_BPP_URI || 'https://workbench.ondc.tech',
  };

  const pincode = body.pincode || DEFAULT_PIN;
  const gps = body.gps || DEFAULT_GPS;

  const provider = state.provider || { id: 'provider_workbench_1', locations: [{ id: 'L1' }] };
  
  // ✅ FIX: Added tags to baseItem
  const baseItem = {
    id: state.item?.id || 'item_veg_thali',
    location_id: state.item?.location_id || 'L1',
    quantity: { count: body.quantity || 1 },
    tags: [{ code: "type", list: [{ code: "type", value: "item" }] }]
  };

  const billing = {
    name: 'Test User',
    address: {
      name: 'Test User', building: 'Main Road', locality: 'Test Locality',
      city: 'Delhi', state: 'Delhi', country: DEFAULT_COUNTRY, area_code: pincode,
    },
    phone: '9876543210',
    email: 'test@nnlgharpro.com',
  };

  const fulfillment = {
    id: 'F1',
    type: 'Delivery',
    end: {
      location: { gps, address: { area_code: pincode } },
      contact: { phone: '9876543210', email: 'test@nnlgharpro.com' },
    },
  };

  let message = {};

  if (action === 'search') {
    message = {
      intent: {
        item: { descriptor: { name: body.query || 'Food' } },
        fulfillment: { type: 'Delivery', end: { location: { gps, address: { area_code: pincode } } } },
        payment: {
          '@ondc/org/buyer_app_finder_fee_type': body.fee_type || 'percent',
          '@ondc/org/buyer_app_finder_fee_amount': String(body.fee_amount || '3'),
        },
      },
    };
  } 
  else if (action === 'select') {
    // ✅ FIX: Strict Select (No billing, No fulfillments here)
    message = {
      order: {
        provider,
        items: [baseItem]
      },
    };
  } 
  else if (action === 'init') {
    const sel = state.on_select_order || {};
    message = {
      order: {
        provider: sel.provider ? { id: sel.provider.id, locations: provider.locations } : provider,
        items: sel.items || [baseItem],
        billing,
        fulfillments: [fulfillment],
        payment: { type: 'POST-FULFILLMENT', collected_by: 'BPP' },
      },
    };
  } 
  else if (action === 'confirm') {
    const ini = state.on_init_order || {};
    const now = new Date().toISOString();
    message = {
      order: {
        id: transactionId,
        state: 'Created',
        provider: ini.provider ? { id: ini.provider.id, locations: provider.locations } : provider,
        items: ini.items || [baseItem],
        billing,
        fulfillments: [fulfillment],
        quote: ini.quote,
        payment: {
          ...(ini.payment || {}),
          type: 'POST-FULFILLMENT',
          status: 'NOT-PAID',
          collected_by: 'BPP',
        },
        created_at: now,
        updated_at: now,
      },
    };
  }

  return { context, message };
}
