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
        return json({ status: 'active', domain: env.ONDC_DOMAIN, bap_id: env.ONDC_BAP_ID });
      }

      // ✅ FRONTEND POLLING ROUTE (Yeh missing tha)
      if (path === 'get_state') {
        const txId = url.searchParams.get('tx');
        if (!txId) return json({ error: 'tx param required' }, 400);
        const state = await loadState(txId, env);
        return json({ success: true, state });
      }

      // ✅ CALLBACK HANDLER (Yeh bhi fix kiya gaya hai)
      if (path.startsWith('on_')) {
        let body = {};
        if (request.method === 'POST') {
          try { body = await request.json(); } catch (e) {}
        }
        console.log(`[CALLBACK ${path}]`, JSON.stringify(body).slice(0, 3000));
        ctx.waitUntil(saveCallback(path, body, env));
        return json({ message: { ack: { status: 'ACK' } } });
      }

      const action = path.startsWith('client_') ? path.replace('client_', '') : path;
      if (ACTIONS.includes(action)) {
        let body = {};
        if (request.method === 'POST') {
          try { body = await request.json(); } catch (e) {}
        }

        const given = body && body.context && body.message ? body : null;
        const transactionId = given?.context?.transaction_id || body?.context?.transaction_id || body.transaction_id || crypto.randomUUID();
        const messageId = given?.context?.message_id || body?.context?.message_id || body.message_id || crypto.randomUUID();
        
        const state = await loadState(transactionId, env);

        const payload = given
          ? { ...given, context: { ...given.context, timestamp: new Date().toISOString() } }
          : buildPayload(action, body, transactionId, messageId, state, env);
          
        const bodyString = JSON.stringify(payload);
        const authHeader = await signRequest(bodyString, env);
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

        const res = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: bodyString,
        });
        const text = await res.text();
        
        await saveState(transactionId, { last_action: action, last_action_at: new Date().toISOString() }, env);

        return json({
          success: res.ok,
          action,
          transaction_id: transactionId,
          gateway_status: res.status,
          gateway_response: safeParse(text),
          sent_payload: payload,
        }, res.ok ? 200 : 502);
      }

      return json({ error: 'Route not mapped' }, 404);
    } catch (error) {
      console.log('[ERROR]', error.message, error.stack);
      return json({ error: error.message }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function safeParse(t) {
  try { return JSON.parse(t); } catch (e) { return t; }
}

function getPrivateKey(env) {
  return env.ONDC_SIGNING_PRIVATE_KEY || env.ONDC_PRIVATE_KEY || '';
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function signRequest(bodyString, env) {
  const rawKey = getPrivateKey(env);
  if (!rawKey) throw new Error('Private key secret nahi mila.');

  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;

  const digest = bytesToB64(blake2b(bodyString, null, 64));
  const signingString = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;

  const priv = b64ToBytes(rawKey.trim());
  const secretKey = priv.length === 32 ? nacl.sign.keyPair.fromSeed(priv).secretKey : priv;

  const signature = bytesToB64(nacl.sign.detached(new TextEncoder().encode(signingString), secretKey));

  return (
    `Signature keyId="${env.ONDC_BAP_ID}|${env.ONDC_UK_ID}|ed25519",` +
    `algorithm="ed25519",created="${created}",expires="${expires}",` +
    `headers="(created) (expires) digest",signature="${signature}"`
  );
}

async function loadState(txId, env) {
  try {
    const v = await env.ONDC_DATA.get(`tx:${txId}`);
    return v ? JSON.parse(v) : {};
  } catch (e) {
    return {};
  }
}

async function saveState(txId, patch, env) {
  const cur = await loadState(txId, env);
  await env.ONDC_DATA.put(`tx:${txId}`, JSON.stringify({ ...cur, ...patch }), { expirationTtl: 86400 });
}

async function saveCallback(path, body, env) {
  try {
    const txId = body?.context?.transaction_id;
    if (!txId) return;

    if (path === 'on_search') {
      const providers = body.message?.catalog?.['bpp/providers'] || [];
      await saveState(txId, {
        bpp_id: body.context.bpp_id,
        bpp_uri: body.context.bpp_uri,
        on_search_catalog: body.message?.catalog || {}, // Save full catalog
      }, env);
    } else if (path === 'on_select' && body.message?.order) {
      await saveState(txId, { on_select_order: body.message.order }, env);
    } else if (path === 'on_init' && body.message?.order) {
      await saveState(txId, { on_init_order: body.message.order }, env);
    }
  } catch (e) {
    console.log('[saveCallback error]', e.message);
  }
}

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
  };

  if (action !== 'search') {
    context.bpp_id = body.bpp_id || state.bpp_id || env.ONDC_BPP_ID || 'workbench.ondc.tech';
    context.bpp_uri = body.bpp_uri || state.bpp_uri || env.ONDC_BPP_URI || 'https://workbench.ondc.tech';
  }

  const pincode = body.pincode || DEFAULT_PIN;
  const gps = body.gps || DEFAULT_GPS;
  const provider = state.provider || { id: body.providerId || 'provider_workbench_1', locations: [{ id: 'L1' }] };
  
  const baseItem = {
    id: state.item?.id || body.itemId || 'item_veg_thali',
    location_id: state.item?.location_id || 'L1',
    quantity: { count: body.quantity || 1 },
    tags: [{ code: "type", list: [{ code: "type", value: "item" }] }]
  };

  const billing = {
    name: body.name || 'Test User',
    address: { name: body.name || 'Test User', building: 'Main Road', locality: 'Test Locality', city: 'Delhi', state: 'Delhi', country: DEFAULT_COUNTRY, area_code: pincode },
    phone: body.phone || '9876543210',
    email: body.email || 'test@nnlgharpro.com',
  };

  const fulfillment = {
    id: 'F1',
    type: 'Delivery',
    end: {
      location: { gps, address: { area_code: pincode } },
      person: { name: body.name || 'Test User' }, 
      contact: { phone: body.phone || '9876543210', email: body.email || 'test@nnlgharpro.com' },
    },
  };

  let message = {};

  if (action === 'search') {
    message = {
      intent: {
        item: { descriptor: { name: body.query || 'Food' } },
        fulfillment: { type: 'Delivery', end: { location: { gps, address: { area_code: pincode } } } },
        payment: { '@ondc/org/buyer_app_finder_fee_type': 'percent', '@ondc/org/buyer_app_finder_fee_amount': '3' },
      },
    };
  } else if (action === 'select') {
    message = {
      order: {
        provider: provider,
        items: [baseItem],
        fulfillments: [{ id: "F1", type: "Delivery", end: { location: { gps: gps, address: { area_code: pincode } }, person: { name: "Test User" }, contact: { phone: "9876543210", email: "test@nnlgharpro.com" } } }]
      },
    };
  } else if (action === 'init') {
    const sel = state.on_select_order || {};
    message = {
      order: {
        provider: sel.provider ? { id: sel.provider.id, locations: provider.locations } : provider,
        items: sel.items || [baseItem],
        billing,
        fulfillments: [fulfillment],
        payment: { type: 'POST-FULFILLMENT', collected_by: 'BPP' },
        quote: sel.quote || { price: { currency: "INR", value: "150.00" }, breakup: [{ title: "Item", price: { currency: "INR", value: "150.00" } }] }
      },
    };
  } else if (action === 'confirm') {
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
        quote: ini.quote || { price: { currency: "INR", value: "150.00" }, breakup: [{ title: "Item", price: { currency: "INR", value: "150.00" } }] },
        payment: { ...(ini.payment || {}), type: 'POST-FULFILLMENT', status: 'NOT-PAID', collected_by: 'BPP', '@ondc/org/settlement_basis': 'delivery', '@ondc/org/settlement_window': 'PT24H' },
        created_at: now,
        updated_at: now,
      },
    };
  }

  return { context, message };
}
