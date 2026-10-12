// ═══════════════════════════════════════════════════════════
// 🍔 NNLGHARPRO ONDC API — Food & Beverage (RET11)
// ═══════════════════════════════════════════════════════════

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    console.log(`📥 ${request.method} ${path}`);
    
    try {
      // ═══════════════════════════════════════════════════
      // HEALTH & STATUS
      // ═══════════════════════════════════════════════════
      
      if (path === '/' || path === '/api/health') {
        return jsonResponse({
          status: 'active',
          service: 'NnlGharPro ONDC API',
          domain: 'ONDC:RET11',
          version: '1.2.5',
          timestamp: new Date().toISOString()
        }, corsHeaders);
      }
      
      // ═══════════════════════════════════════════════════
      // OUTGOING REQUESTS (Aap bhejte ho Workbench ko)
      // ═══════════════════════════════════════════════════
      
      if (path === '/search')  return await handleSearch(request, env);
      if (path === '/select')  return await handleSelect(request, env);
      if (path === '/init')    return await handleInit(request, env);
      if (path === '/confirm') return await handleConfirm(request, env);
      
      // ═══════════════════════════════════════════════════
      // INCOMING WEBHOOKS (Workbench aapko bhejta hai)
      // ═══════════════════════════════════════════════════
      
      if (path === '/on_search')  return await handleOnSearch(request, env);
      if (path === '/on_select')  return await handleOnSelect(request, env);
      if (path === '/on_init')    return await handleOnInit(request, env);
      if (path === '/on_confirm') return await handleOnConfirm(request, env);
      if (path === '/on_status')  return await handleOnStatus(request, env);
      if (path === '/on_update')  return await handleOnUpdate(request, env);
      
      // 404 for other routes
      return jsonResponse({
        error: 'Not found',
        path: path
      }, corsHeaders, 404);
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      return jsonResponse({
        error: error.message,
        path: path
      }, corsHeaders, 500);
    }
  }
};

// ═══════════════════════════════════════════════════════════
// 🔧 HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

function jsonResponse(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    }
  });
}

function generateUUID() {
  return crypto.randomUUID();
}

function getTimestamp() {
  return new Date().toISOString();
}

// ═══════════════════════════════════════════════════════════
// 📤 OUTGOING: /search
// ═══════════════════════════════════════════════════════════

async function handleSearch(request, env) {
  const body = await request.json().catch(() => ({}));
  
  const transactionId = generateUUID();
  const messageId = generateUUID();
  
  const searchPayload = {
    context: {
      domain: 'ONDC:RET11',
      action: 'search',
      version: '1.2.5',
      bap_id: 'nnlgharpro-ondc.nnlgharpro.workers.dev',
      bap_uri: 'https://nnlgharpro-ondc.nnlgharpro.workers.dev',
      transaction_id: transactionId,
      message_id: messageId,
      timestamp: getTimestamp(),
      ttl: 'PT30S'
    },
    message: {
      intent: {
        category: {
          descriptor: {
            name: body.category || 'Food'
          }
        },
        fulfillment: {
          type: 'Delivery'
        },
        payment: {
          '@ondc/org/buyer_app_finder_fee_type': 'percent',
          '@ondc/org/buyer_app_finder_fee_amount': '3'
        }
      }
    }
  };
  
  // Workbench URL pe bhejo
  const workbenchUrl = 'https://workbench.ondc.tech/api-service/ONDC:RET11/1.2.5/seller/search';
  
  const response = await fetch(workbenchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(searchPayload)
  });
  
  const data = await response.json().catch(() => ({}));
  
  return jsonResponse({
    success: true,
    transactionId: transactionId,
    messageId: messageId,
    workbenchResponse: data,
    sentPayload: searchPayload
  }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📤 OUTGOING: /select
// ═══════════════════════════════════════════════════════════

async function handleSelect(request, env) {
  const body = await request.json().catch(() => ({}));
  
  const selectPayload = {
    context: {
      domain: 'ONDC:RET11',
      action: 'select',
      version: '1.2.5',
      bap_id: 'nnlgharpro-ondc.nnlgharpro.workers.dev',
      bap_uri: 'https://nnlgharpro-ondc.nnlgharpro.workers.dev',
      transaction_id: body.transactionId || generateUUID(),
      message_id: generateUUID(),
      timestamp: getTimestamp(),
      ttl: 'PT30S'
    },
    message: {
      order: {
        provider: { id: body.providerId || 'provider_1' },
        items: body.items || [{
          id: 'item_1',
          quantity: { count: 1 }
        }],
        fulfillment: {
          type: 'Delivery',
          end: {
            location: {
              gps: '28.0444,76.1084',
              address: {
                area_code: '123001'
              }
            }
          }
        }
      }
    }
  };
  
  const workbenchUrl = 'https://workbench.ondc.tech/api-service/ONDC:RET11/1.2.5/seller/select';
  
  const response = await fetch(workbenchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selectPayload)
  });
  
  const data = await response.json().catch(() => ({}));
  
  return jsonResponse({
    success: true,
    workbenchResponse: data,
    sentPayload: selectPayload
  }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📤 OUTGOING: /init
// ═══════════════════════════════════════════════════════════

async function handleInit(request, env) {
  const body = await request.json().catch(() => ({}));
  
  const initPayload = {
    context: {
      domain: 'ONDC:RET11',
      action: 'init',
      version: '1.2.5',
      bap_id: 'nnlgharpro-ondc.nnlgharpro.workers.dev',
      bap_uri: 'https://nnlgharpro-ondc.nnlgharpro.workers.dev',
      transaction_id: body.transactionId || generateUUID(),
      message_id: generateUUID(),
      timestamp: getTimestamp(),
      ttl: 'PT30S'
    },
    message: {
      order: {
        provider: { id: body.providerId || 'provider_1' },
        items: body.items || [{ id: 'item_1', quantity: { count: 1 } }],
        billing: body.billing || {
          name: 'Customer',
          phone: '9588562553',
          address: {
            city: 'Narnaul',
            state: 'Haryana',
            country: 'IND',
            area_code: '123001'
          }
        },
        fulfillment: {
          type: 'Delivery',
          end: {
            location: {
              gps: '28.0444,76.1084',
              address: { area_code: '123001' }
            },
            contact: { phone: '9588562553' }
          }
        }
      }
    }
  };
  
  const workbenchUrl = 'https://workbench.ondc.tech/api-service/ONDC:RET11/1.2.5/seller/init';
  
  const response = await fetch(workbenchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initPayload)
  });
  
  const data = await response.json().catch(() => ({}));
  
  return jsonResponse({
    success: true,
    workbenchResponse: data,
    sentPayload: initPayload
  }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📤 OUTGOING: /confirm
// ═══════════════════════════════════════════════════════════

async function handleConfirm(request, env) {
  const body = await request.json().catch(() => ({}));
  
  const confirmPayload = {
    context: {
      domain: 'ONDC:RET11',
      action: 'confirm',
      version: '1.2.5',
      bap_id: 'nnlgharpro-ondc.nnlgharpro.workers.dev',
      bap_uri: 'https://nnlgharpro-ondc.nnlgharpro.workers.dev',
      transaction_id: body.transactionId || generateUUID(),
      message_id: generateUUID(),
      timestamp: getTimestamp(),
      ttl: 'PT30S'
    },
    message: {
      order: body.order || {
        provider: { id: 'provider_1' },
        items: [{ id: 'item_1', quantity: { count: 1 } }],
        payment: {
          type: 'ON-FULFILLMENT',
          status: 'PAID',
          collected_by: 'BAP'
        }
      }
    }
  };
  
  const workbenchUrl = 'https://workbench.ondc.tech/api-service/ONDC:RET11/1.2.5/seller/confirm';
  
  const response = await fetch(workbenchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(confirmPayload)
  });
  
  const data = await response.json().catch(() => ({}));
  
  return jsonResponse({
    success: true,
    workbenchResponse: data,
    sentPayload: confirmPayload
  }, { 'Content-Type': 'application/json' });
}

// ═══════════════════════════════════════════════════════════
// 📥 INCOMING WEBHOOKS (Workbench Response)
// ═══════════════════════════════════════════════════════════

async function handleOnSearch(request, env) {
  const body = await request.json();
  console.log('📥 on_search received:', body.context?.transaction_id);
  
  return jsonResponse({
    message: { ack: { status: 'ACK' } }
  }, { 'Content-Type': 'application/json' });
}

async function handleOnSelect(request, env) {
  const body = await request.json();
  console.log('📥 on_select received:', body.context?.transaction_id);
  
  return jsonResponse({
    message: { ack: { status: 'ACK' } }
  }, { 'Content-Type': 'application/json' });
}

async function handleOnInit(request, env) {
  const body = await request.json();
  console.log('📥 on_init received:', body.context?.transaction_id);
  
  return jsonResponse({
    message: { ack: { status: 'ACK' } }
  }, { 'Content-Type': 'application/json' });
}

async function handleOnConfirm(request, env) {
  const body = await request.json();
  console.log('📥 on_confirm received:', body.context?.transaction_id);
  
  return jsonResponse({
    message: { ack: { status: 'ACK' } }
  }, { 'Content-Type': 'application/json' });
}

async function handleOnStatus(request, env) {
  const body = await request.json();
  console.log('📥 on_status received:', body.context?.transaction_id);
  
  return jsonResponse({
    message: { ack: { status: 'ACK' } }
  }, { 'Content-Type': 'application/json' });
}

async function handleOnUpdate(request, env) {
  const body = await request.json();
  console.log('📥 on_update received:', body.context?.transaction_id);
  
  return jsonResponse({
    message: { ack: { status: 'ACK' } }
  }, { 'Content-Type': 'application/json' });
}

console.log('✅ NnlGharPro ONDC API (RET11) loaded');
