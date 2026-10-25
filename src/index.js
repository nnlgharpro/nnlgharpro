// ONDC BAP worker (RET11 / Workbench) - v3
// Install: npm install blakejs tweetnacl
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
      // Health
      if (path === '' || path === 'api/health') {
        return json({ status: 'active', domain: env.ONDC_DOMAIN, bap_id: env.ONDC_BAP_ID, has_private_key: !!getPrivateKey(env) });
      }

      // 1. Callbacks from workbench: /on_search, /on_select, /on_init, /on_confirm ...
      if (path.startsWith('on_')) {
        let body = {};
        if (request.method === 'POST') {
          try { body = await request.json(); } catch (e) {}
        }
        console.log(`[CALLBACK ${path}]`, JSON.stringify(body).slice(0, 3000));
        ctx.waitUntil(saveCallback(path, body, env));
        return json({ message: { ack: { status: 'ACK' } } });
      }

      // 2. Actions you trigger: /search, /select, /init, /confirm (or /client_search ...)
      const action = path.startsWith('client_') ? path.replace('client_', '') : path;
      if (ACTIONS.includes(action)) {
        let body = {};
        if (request.method === 'POST') {
          try { body = await request.json(); } catch (e) {}
        }

        const transactionId = body.transaction_id || crypto.randomUUID();
        const messageId = body.message_id || crypto.randomUUID();
        const state = await loadState(transactionId, env);

        const payload = buildPayload(action, body, transactionId, messageId, state, env);
        const bodyString = JSON.stringify(payload);
        const authHeader = await signRequest(bodyString, env);
        const gatewayUrl = `${env.ONDC_GATEWAY_URL}/${action}`;

        const res = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: bodyString,
        });
        const text = await res.text();
        console.log(`[${action.toUpperCase()}] ${gatewayUrl} | Status: ${res.status} | Response: ${text}`);

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

/* ---------------- helpers ---------------- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function safeParse(t) {
  try { return JSON.parse(t); } catch (e) { return t; }
}

// Dashboard mein jo naam ho, dono chalenge
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

// ONDC signature: ed25519 over (created)/(expires)/digest, digest = BLAKE-512
async function signRequest(bodyString, env) {
  const rawKey = getPrivateKey(env);
  if (!rawKey) throw new Error('Private key secret nahi mila. Cloudflare mein ONDC_SIGNING_PRIVATE_KEY (Secret) add karein.');

  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;

  const digest = bytesToB64(blake2b(new TextEncoder().encode(bodyString), null, 64));
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

/* ---------------- state (KV) ---------------- */

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
      const prov = providers[0];
      const item = prov?.items?.[0];
      await saveState(txId, {
        bpp_id: body.context.bpp_id,
        bpp_uri: body.context.bpp_uri,
        provider: prov ? { id: prov.id, locations: prov.locations?.[0] ? [{ id: prov.locations[0].id }] : [] } : undefined,
        item: item ? { id: item.id, location_id: item.location_id || prov.locations?.[0]?.id } : undefined,
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

/* ---------------- payload builder ---------------- */

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

  // Workbench sample ke hisaab se bpp_id / bpp_uri search mein bhi jaate hain.
  context.bpp_id = body.bpp_id || state.bpp_id || env.ONDC_BPP_ID || 'workbench.ondc.tech';
  context.bpp_uri = body.bpp_uri || state.bpp_uri || env.ONDC_BPP_URI || 'https://workbench.ondc.tech';

  const pincode = body.pincode || DEFAULT_PIN;
  const gps = body.gps || DEFAULT_GPS;

  const provider = state.provider || { id: 'provider_workbench_1', locations: [{ id: 'L1' }] };
  const baseItem = {
    id: state.item?.id || 'item_veg_thali',
    location_id: state.item?.location_id || 'L1',
    quantity: { count: body.quantity || 1 },
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
      },
    };
  } else if (action === 'select') {
    message = {
      order: {
        provider,
        items: [baseItem],
        fulfillments: [{ end: { location: { gps, address: { area_code: pincode } } } }],
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
      },
    };
  } else if (action === 'confirm') {
    const ini = state.on_init_order || {};
    const now = new Date().toISOString();
    message = {
      order: {
        id: crypto.randomUUID(),
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
