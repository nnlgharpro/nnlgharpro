// ═══════════════════════════════════════════════════════════
// 🚀 NNLGHARPRO ONDC API — Universal Multi-Domain Backend
// ═══════════════════════════════════════════════════════════

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS Headers (ताकि आपका फ्रंटएंड आसानी से बात कर सके)
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
      // ═══════════════════════════════════════════════════
      // HEALTH CHECK
      // ═══════════════════════════════════════════════════
      if (path === '/' || path === '/api/health') {
        return jsonResponse({
          status: 'active',
          service: 'NnlGharPro ONDC Universal API',
          supported_domains: ['ONDC:RET10', 'ONDC:RET11', 'ONDC:SRV11', 'ONDC:SRV13', 'ONDC:TRV10'],
          version: '3.0.0',
          timestamp: new Date().toISOString()
        }, corsHeaders);
      }
      
      // ═══════════════════════════════════════════════════
      // OUTGOING REQUESTS (Frontend -> ONDC)
      // ═══════════════════════════════════════════════════
      const outgoingActions = ['search', 'select', 'init', 'confirm', 'status', 'cancel', 'update', 'track', 'support', 'rating'];
      const action = path.replace('/', ''); // e.g., '/search' -> 'search'
      
      if (outgoingActions.includes(action)) {
        return await handleOutgoingRequest(action, request, env);
      }
      
      // ═══════════════════════════════════════════════════
      // INCOMING WEBHOOKS (ONDC -> Frontend)
      // ═══════════════════════════════════════════════════
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
// 🧠 UNIVERSAL PAYLOAD BUILDER (Domain ke hisaab se badalta hai)
// ═══════════════════════════════════════════════════════════

function buildPayload(action, domain, body, env) {
  // Common Context
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

  // 1. SERVICE DOMAINS (Plumber, Electrician, Home Cleaning)
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
    // Default Service Order Structure
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

  // 2. RETAIL DOMAINS (Food, Grocery, Home Decor, Beauty)
  // Includes: RET10, RET11, RET12, RET13, RET14, RET15
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
    // Default Retail Order Structure
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

  // 3. TRAVEL & MOBILITY (Cab, Bus)
  if (domain.startsWith('ONDC:TRV')) {
    return {
      context,
      message: { 
        intent: body.intent || {},
        order: body.order || {}
      }
    };
  }

  // Fallback (Agar koi naya domain aaye)
  return { context, message: { intent: body.intent || {}, order: body.order || {} } };
}

// ═══════════════════════════════════════════════════════════
// 📤 OUTGOING HANDLER (Universal)
// ═══════════════════════════════════════════════════════════

async function handleOutgoingRequest(action, request, env) {
  const body = await request.json().catch(() => ({}));
  
  // Default domain RET11 (Food) agar frontend se nahi aaya
  const domain = body.domain || env.ONDC_DOMAIN || 'ONDC:RET11'; 
  
  const payload = buildPayload(action, domain, body, env);
  
  // Workbench URL (Testing ke liye)
  const workbenchUrl = `https://workbench.ondc.tech/api-service/${domain}/1.2.5/seller/${action}`;
  
  const response = await fetch(workbenchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // TODO: Add Authorization Signature here
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
// 📥 INCOMING WEBHOOK HANDLER (Universal)
// ═══════════════════════════════════════════════════════════

async function handleIncomingWebhook(path, request, env) {
  const body = await request.json();
  const action = path.replace('/on_', ''); // e.g., '/on_search' -> 'search'
  
  console.log(`📥 [WEBHOOK] on_${action} received for TXN: ${body.context?.transaction_id}`);
  
  // यहाँ आप Database (Cloudflare D1/KV) में डेटा सेव कर सकते हैं
  // उदाहरण: await env.DB.prepare("INSERT INTO orders ...").bind(...).run();

  // ONDC को हमेशा ACK भेजना ज़रूरी है
  return jsonResponse({
    message: { ack: { status: 'ACK' } }
  }, { 'Content-Type': 'application/json' });
}

console.log('✅ NnlGharPro ONDC Universal API (v3.0.0) loaded');
