export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
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
    
    // Routes
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        status: 'active',
        service: 'NnlGharPro ONDC API',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        ondc_configured: !!env.ONDC_PRIVATE_KEY
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // 404 for other routes
    return new Response(JSON.stringify({
      error: 'Not found',
      path: url.pathname
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
