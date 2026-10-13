// ═══════════════════════════════════════════════════════════
// 🛋️ NNLGHARPRO ONDC API — Home Decor (RET15)
// ═══════════════════════════════════════════════════════════

const DOMAIN = 'ONDC:RET15';
const VERSION = '1.2.5';
const BAP_ID = 'nnlgharpro-ret15.nnlgharpro.workers.dev';
const BAP_URI = 'https://nnlgharpro-ret15.nnlgharpro.workers.dev';

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
        category: { descriptor: { name: body.category || 'Home Decor' } },
        fulfillment: { type: 'Delivery' },
        payment: {
          '@ondc/org/buyer_app_finder_fee_type': 'percent',
          '@ondc/org/buyer_app_finder_fee_amount': '3'
        }
      }
    }
  };
  
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${DOMAIN}/${VERSION}/seller/search`;
  const response = await fetch(workbenchUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  
  return jsonResponse({
    success: true, transactionId: payload.context.transaction_id,
    workbenchResponse: data, sentPayload: payload
  }, { 'Content-Type': 'application/json' });
}

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
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${DOMAIN}/${VERSION}/seller/select`;
  const response = await fetch(workbenchUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return jsonResponse({ success: true, workbenchResponse: data, sentPayload: payload }, { 'Content-Type': 'application/json' });
}

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
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${DOMAIN}/${VERSION}/seller/init`;
  const response = await fetch(workbenchUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return jsonResponse({ success: true, workbenchResponse: data, sentPayload: payload }, { 'Content-Type': 'application/json' });
}

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
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${DOMAIN}/${VERSION}/seller/confirm`;
  const response = await fetch(workbenchUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  return jsonResponse({ success: true, workbenchResponse: data, sentPayload: payload }, { 'Content-Type': 'application/json' });
}

console.log(`✅ NnlGharPro ONDC API (${DOMAIN}) loaded`);
