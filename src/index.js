// ONDC BAP Worker — RET11 / Core 1.2.5
// Routes:
//   POST /search, /select, /init, /confirm
//   POST /on_search, /on_select, /on_init, /on_confirm
//   GET  / or /api/health
//
// Install dependencies:
//   npm install blakejs tweetnacl
//
// IMPORTANT:
// - Keep ONDC_SIGNING_PRIVATE_KEY in Cloudflare Worker Secrets.
// - Set ONDC_DEFAULT_GPS and ONDC_DEFAULT_PIN to one real, matching delivery
//   location, or provide gps/pincode in each request.
// - This worker does not invent provider/item IDs. It uses on_search callback
//   data or a complete Workbench payload.

import { blake2b } from "blakejs";
import nacl from "tweetnacl";

const ACTIONS = ["search", "select", "init", "confirm"];
const CALLBACK_ACTIONS = ["on_search", "on_select", "on_init", "on_confirm"];
const TTL = "PT30S";
const COUNTRY = "IND";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Gateway-Authorization",
};

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (request.method === "GET" && (path === "" || path === "api/health")) {
        return json({
          status: "active",
          domain: env.ONDC_DOMAIN || "ONDC:RET11",
          core_version: env.ONDC_CORE_VERSION || "1.2.5",
          bap_id_configured: Boolean(env.ONDC_BAP_ID),
          bap_uri: env.ONDC_BAP_URI || null,
          gateway_configured: Boolean(env.ONDC_GATEWAY_URL),
          signing_private_key_configured: Boolean(getPrivateKey(env)),
          kv_configured: Boolean(env.ONDC_DATA),
        });
      }

      if (request.method !== "POST") {
        throw new HttpError(405, "Use POST for ONDC actions and callbacks.");
      }

      const body = await readJson(request);

      // Workbench callbacks: /on_search, /on_select, /on_init, /on_confirm
      if (CALLBACK_ACTIONS.includes(path)) {
        const result = await handleCallback(path, body, env);
        return json(result);
      }

      // Optional aliases: /client_search, /client_select, etc.
      const action = path.startsWith("client_")
        ? path.slice("client_".length)
        : path;

      if (!ACTIONS.includes(action)) {
        throw new HttpError(404, `Route not mapped: /${path}`);
      }

      const result = await handleAction(action, body, env);
      return json(result, result.http_status || 200);
    } catch (error) {
      console.error("[WORKER_ERROR]", error.message, error.details || "");
      const status = error instanceof HttpError ? error.status : 500;
      return json(
        {
          success: false,
          error: error.message || "Internal worker error",
          details: error.details || undefined,
        },
        status
      );
    }
  },
};

async function handleAction(action, body, env) {
  assertActionConfig(env);

  // Workbench may send the full {context, message} payload directly,
  // or wrap it in body.payload.
  const suppliedPayload =
    isOnDcPayload(body?.payload) ? body.payload :
    isOnDcPayload(body) ? body :
    null;

  const transactionId =
    suppliedPayload?.context?.transaction_id ||
    body.transaction_id ||
    env.ONDC_TRANSACTION_ID ||
    crypto.randomUUID();

  const state = await loadState(transactionId, env);
  const messageId =
    suppliedPayload?.context?.message_id ||
    body.message_id ||
    crypto.randomUUID();

  let payload;

  if (suppliedPayload) {
    payload = JSON.parse(JSON.stringify(suppliedPayload));
    payload.context = {
      ...payload.context,
      domain: payload.context.domain || env.ONDC_DOMAIN || "ONDC:RET11",
      country: payload.context.country || COUNTRY,
      city: payload.context.city || env.ONDC_CITY || "std:011",
      action,
      core_version:
        payload.context.core_version || env.ONDC_CORE_VERSION || "1.2.5",
      bap_id: payload.context.bap_id || env.ONDC_BAP_ID,
      bap_uri: payload.context.bap_uri || env.ONDC_BAP_URI,
      transaction_id: transactionId,
      message_id: messageId,
      timestamp: new Date().toISOString(),
      ttl: payload.context.ttl || TTL,
      // Workbench test mode uses its BPP identity in the request context.
      ...(payload.context.bpp_id || state.bpp_id || env.ONDC_BPP_ID
        ? { bpp_id: payload.context.bpp_id || state.bpp_id || env.ONDC_BPP_ID }
        : {}),
      ...(payload.context.bpp_uri || state.bpp_uri || env.ONDC_BPP_URI
        ? { bpp_uri: payload.context.bpp_uri || state.bpp_uri || env.ONDC_BPP_URI }
        : {}),
    };
  } else {
    payload = await buildPayload(
      action,
      body,
      transactionId,
      messageId,
      state,
      env
    );
  }

  if (!payload.message || !payload.context) {
    throw new HttpError(400, "Payload must contain context and message.");
  }

  // The uploaded Workbench log shows SELECT was NACKed because the end
  // location GPS and area_code were absent. Repair only missing fields;
  // never overwrite a location already supplied by the caller.
  if (action === "select") {
    ensureSelectFulfillment(payload, body, env);
  }

  // Save the exact outgoing message_id so callback correlation can be logged.
  state.request_message_ids = {
    ...(state.request_message_ids || {}),
    [action]: messageId,
  };
  await saveState(transactionId, state, env);

  const bodyString = JSON.stringify(payload);
  const authorization = await signRequest(bodyString, env);
  const gatewayBase = env.ONDC_GATEWAY_URL.replace(/\/+$/, "");
  const gatewayUrl = `${gatewayBase}/${action}`;

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: bodyString,
  });

  const responseText = await response.text();
  const gatewayResponse = safeParse(responseText);
  const ackStatus =
    gatewayResponse?.message?.ack?.status ||
    gatewayResponse?.response?.message?.ack?.status ||
    null;

  console.log(
    `[${action.toUpperCase()}] ${gatewayUrl} status=${response.status} ` +
    `ack=${ackStatus || "unknown"} tx=${transactionId} msg=${messageId}`
  );

  return {
    success: response.ok && ackStatus !== "NACK",
    action,
    transaction_id: transactionId,
    message_id: messageId,
    gateway_status: response.status,
    ack_status: ackStatus,
    gateway_response: gatewayResponse,
    // Useful during Workbench debugging. Remove this field for production
    // if you do not want the full outgoing payload in the API response.
    sent_payload: payload,
  };
}

async function buildPayload(action, body, transactionId, messageId, state, env) {
  const location = getDeliveryLocation(body, env);

  const context = {
    domain: env.ONDC_DOMAIN || "ONDC:RET11",
    country: COUNTRY,
    city: body.city || env.ONDC_CITY || "std:011",
    action,
    core_version: env.ONDC_CORE_VERSION || "1.2.5",
    bap_id: env.ONDC_BAP_ID,
    bap_uri: env.ONDC_BAP_URI.replace(/\/+$/, ""),
    transaction_id: transactionId,
    message_id: messageId,
    timestamp: new Date().toISOString(),
    ttl: TTL,
  };

  // Keep these only for the ONDC Workbench test environment where the
  // supplied logs show them in the outgoing BAP request context.
  const bppId = body.bpp_id || state.bpp_id || env.ONDC_BPP_ID;
  const bppUri = body.bpp_uri || state.bpp_uri || env.ONDC_BPP_URI;
  if (bppId) context.bpp_id = bppId;
  if (bppUri) context.bpp_uri = bppUri;

  let message;

  if (action === "search") {
    if (!location.gps || !location.area_code) {
      throw new HttpError(
        400,
        "SEARCH needs a delivery location. Set ONDC_DEFAULT_GPS and " +
          "ONDC_DEFAULT_PIN, or send gps and pincode in the request."
      );
    }

    message = {
      intent: {
        item: {
          descriptor: { name: body.query || "Food" },
        },
        fulfillment: {
          type: "Delivery",
          end: {
            location: {
              gps: location.gps,
              address: { area_code: location.area_code },
            },
          },
        },
        payment: {
          "@ondc/org/buyer_app_finder_fee_type": body.fee_type || "percent",
          "@ondc/org/buyer_app_finder_fee_amount": String(
            body.fee_amount ?? "3"
          ),
        },
      },
    };
  }

  if (action === "select") {
    const provider = selectProvider(state, body);
    const item = selectItem(state, body, provider);

    if (!location.gps || !location.area_code) {
      throw new HttpError(
        400,
        "SELECT needs delivery GPS and pincode. Set ONDC_DEFAULT_GPS and " +
          "ONDC_DEFAULT_PIN or send gps and pincode."
      );
    }

    const selectedItem = {
      id: item.id,
      location_id:
        body.location_id || item.location_id || provider.locations?.[0]?.id,
      quantity: { count: Number(body.quantity || 1) },
      ...(Array.isArray(item.tags) ? { tags: item.tags } : {}),
    };

    if (!selectedItem.location_id) {
      throw new HttpError(
        400,
        "Selected catalog item has no location_id. Check the on_search catalog."
      );
    }

    message = {
      order: {
        provider: {
          id: provider.id,
          ...(provider.locations?.length
            ? { locations: provider.locations }
            : {}),
        },
        items: [selectedItem],
        fulfillments: [
          {
            type: "Delivery",
            end: {
              location: {
                gps: location.gps,
                address: { area_code: location.area_code },
              },
            },
          },
        ],
      },
    };
  }

  if (action === "init") {
    const selectedOrder = state.on_select_order;
    if (!selectedOrder) {
      throw new HttpError(
        409,
        "No successful on_select order is saved for this transaction. " +
          "Run SELECT and wait for ON_SELECT ACK before INIT."
      );
    }

    const billing = body.billing;
    if (!billing || !billing.address) {
      throw new HttpError(
        400,
        "INIT needs billing details. Send body.billing with an address, " +
          "or submit the complete Workbench {context, message} payload."
      );
    }

    const fulfillments =
      body.fulfillments ||
      selectedOrder.fulfillments ||
      (location.gps && location.area_code
        ? [
            {
              type: "Delivery",
              end: {
                location: {
                  gps: location.gps,
                  address: { area_code: location.area_code },
                },
              },
            },
          ]
        : []);

    if (!fulfillments.length) {
      throw new HttpError(
        400,
        "INIT needs fulfillment details from ON_SELECT or the request."
      );
    }

    message = {
      order: {
        provider: selectedOrder.provider,
        items: selectedOrder.items,
        billing,
        fulfillments,
        payment:
          body.payment || {
            type: "POST-FULFILLMENT",
            status: "NOT-PAID",
            collected_by: "BPP",
          },
      },
    };
  }

  if (action === "confirm") {
    const initializedOrder = state.on_init_order;
    if (!initializedOrder) {
      throw new HttpError(
        409,
        "No successful on_init order is saved for this transaction. " +
          "Run INIT and wait for ON_INIT ACK before CONFIRM."
      );
    }

    // Do not fabricate BPP-generated order ID/state/timestamps in a BAP
    // confirm request. Carry forward the order returned by on_init.
    const order = JSON.parse(JSON.stringify(initializedOrder));
    delete order.state;
    delete order.created_at;
    delete order.updated_at;

    message = { order };
  }

  return { context, message };
}

function ensureSelectFulfillment(payload, body, env) {
  const order = payload.message?.order;
  if (!order) {
    throw new HttpError(400, "SELECT payload is missing message.order.");
  }

  const existing = Array.isArray(order.fulfillments)
    ? order.fulfillments
    : [];

  const firstEndLocation = existing[0]?.end?.location || {};
  const suppliedGps =
    firstEndLocation.gps || body.gps || env.ONDC_DEFAULT_GPS || "";
  const suppliedPin =
    firstEndLocation.address?.area_code ||
    body.pincode ||
    env.ONDC_DEFAULT_PIN ||
    "";

  if (!suppliedGps || !suppliedPin) {
    throw new HttpError(
      400,
      "SELECT payload is missing fulfillment end.location.gps or " +
        "end.location.address.area_code. Configure ONDC_DEFAULT_GPS and " +
        "ONDC_DEFAULT_PIN with a matching real delivery location."
    );
  }

  const fulfillmentList = existing.length
    ? existing
    : [{ type: "Delivery", end: { location: {} } }];

  order.fulfillments = fulfillmentList.map((fulfillment) => {
    const end = fulfillment.end || {};
    const location = end.location || {};
    const address = location.address || {};

    return {
      ...fulfillment,
      end: {
        ...end,
        location: {
          ...location,
          gps: location.gps || suppliedGps,
          address: {
            ...address,
            area_code: address.area_code || suppliedPin,
          },
        },
      },
    };
  });
}

function getDeliveryLocation(body, env) {
  const payload = isOnDcPayload(body?.payload)
    ? body.payload
    : isOnDcPayload(body)
    ? body
    : null;

  const fulfillment =
    payload?.message?.order?.fulfillments?.[0] ||
    payload?.message?.intent?.fulfillment;

  return {
    gps:
      body.gps ||
      fulfillment?.end?.location?.gps ||
      env.ONDC_DEFAULT_GPS ||
      "",
    area_code:
      body.pincode ||
      fulfillment?.end?.location?.address?.area_code ||
      env.ONDC_DEFAULT_PIN ||
      "",
  };
}

function selectProvider(state, body) {
  const providers = state.providers || [];
  const wantedId = body.provider_id || body.provider?.id;
  const provider =
    (wantedId && providers.find((p) => p.id === wantedId)) ||
    state.provider;

  if (!provider?.id) {
    throw new HttpError(
      409,
      "No provider saved from on_search. Run SEARCH and wait for ON_SEARCH."
    );
  }
  return provider;
}

function selectItem(state, body, provider) {
  const items = provider.items || state.items || [];
  const wantedId = body.item_id || body.item?.id;
  const item =
    (wantedId && items.find((i) => i.id === wantedId)) ||
    state.item ||
    items[0];

  if (!item?.id) {
    throw new HttpError(
      409,
      "No item saved from on_search. Check ON_SEARCH catalog and item IDs."
    );
  }
  return item;
}

async function handleCallback(path, body, env) {
  const transactionId = body?.context?.transaction_id;
  if (!transactionId) {
    console.warn(`[CALLBACK ${path}] missing context.transaction_id`);
    return {
      message: { ack: { status: "ACK" } },
      warning: "Callback received without transaction_id; state not saved.",
    };
  }

  const state = await loadState(transactionId, env);
  const callbackAction = path;
  const requestAction = callbackAction.replace(/^on_/, "");
  const expectedMessageId =
    state.request_message_ids?.[requestAction] || null;
  const receivedMessageId = body?.context?.message_id || null;

  const callbackInfo = {
    action: path,
    message_id: receivedMessageId,
    expected_message_id: expectedMessageId,
    message_id_matches:
      !expectedMessageId || !receivedMessageId
        ? null
        : expectedMessageId === receivedMessageId,
    received_at: new Date().toISOString(),
    has_error: Boolean(body.error || body.message?.error),
  };

  state.last_callback = callbackInfo;
  state.callbacks = {
    ...(state.callbacks || {}),
    [path]: body,
  };

  if (
    body.context?.bpp_id ||
    body.context?.bpp_uri
  ) {
    state.bpp_id = body.context.bpp_id || state.bpp_id;
    state.bpp_uri = body.context.bpp_uri || state.bpp_uri;
  }

  if (path === "on_search") {
    const providers =
      body.message?.catalog?.["bpp/providers"] ||
      body.message?.catalog?.providers ||
      [];

    if (providers.length) {
      state.providers = providers;
      state.provider = providers[0];

      const items = providers[0].items || [];
      state.items = items;
      state.item = items[0] || null;
    }
  }

  if (path === "on_select" && body.message?.order) {
    state.on_select_order = body.message.order;
  }

  if (path === "on_init" && body.message?.order) {
    state.on_init_order = body.message.order;
  }

  if (path === "on_confirm" && body.message?.order) {
    state.on_confirm_order = body.message.order;
  }

  await saveState(transactionId, state, env);

  if (callbackInfo.message_id_matches === false) {
    console.error(
      `[CALLBACK_CORRELATION_MISMATCH] ${path}: expected ` +
        `${expectedMessageId}, received ${receivedMessageId}`
    );
  }

  if (callbackInfo.has_error) {
    console.error(
      `[CALLBACK_ERROR] ${path}`,
      JSON.stringify(body.error || body.message?.error).slice(0, 3000)
    );
  }

  console.log(`[CALLBACK ${path}] saved tx=${transactionId}`);

  // A callback endpoint must ACK receipt promptly. Validation/business
  // errors in the callback are logged and retained for diagnosis.
  return {
    message: { ack: { status: "ACK" } },
    saved: true,
    transaction_id: transactionId,
    callback: callbackInfo,
  };
}

async function loadState(transactionId, env) {
  if (!env.ONDC_DATA) {
    throw new HttpError(500, "Cloudflare KV binding ONDC_DATA is missing.");
  }

  const raw = await env.ONDC_DATA.get(`tx:${transactionId}`);
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    console.error(`[KV] Invalid JSON for transaction ${transactionId}`);
    return {};
  }
}

async function saveState(transactionId, state, env) {
  if (!env.ONDC_DATA) {
    throw new HttpError(500, "Cloudflare KV binding ONDC_DATA is missing.");
  }

  await env.ONDC_DATA.put(
    `tx:${transactionId}`,
    JSON.stringify(state),
    { expirationTtl: 86400 }
  );
}

async function signRequest(bodyString, env) {
  const rawKey = getPrivateKey(env);
  if (!rawKey) {
    throw new HttpError(
      500,
      "Private key secret missing. Add ONDC_SIGNING_PRIVATE_KEY in " +
        Cloudflare Worker Secrets."
    );
  }

  if (!env.ONDC_BAP_ID || !env.ONDC_UK_ID) {
    throw new HttpError(
      500,
      "ONDC_BAP_ID and ONDC_UK_ID must be configured."
    );
  }

  const keyBytes = base64ToBytes(rawKey);
  let keyPair;

  if (keyBytes.length === 32) {
    keyPair = nacl.sign.keyPair.fromSeed(keyBytes);
  } else if (keyBytes.length === 64) {
    keyPair = nacl.sign.keyPair.fromSecretKey(keyBytes);
  } else {
    throw new HttpError(
      500,
      `Private key must decode to 32-byte seed or 64-byte secret key; ` +
        `received ${keyBytes.length} bytes.`
    );
  }

  // If the public key is configured, ensure it belongs to this private key.
  if (env.ONDC_SIGNING_PUBLIC_KEY) {
    const configuredPublicKey = base64ToBytes(
      env.ONDC_SIGNING_PUBLIC_KEY
    );
    if (
      configuredPublicKey.length !== 32 ||
      !equalBytes(configuredPublicKey, keyPair.publicKey)
    ) {
      throw new HttpError(
        500,
        "Private/public key mismatch: ONDC_SIGNING_PRIVATE_KEY does not " +
          "match ONDC_SIGNING_PUBLIC_KEY."
      );
    }
  }

  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;
  const digest = bytesToBase64(
    blake2b(new TextEncoder().encode(bodyString), null, 64)
  );

  const signingString =
    `(created): ${created}\n` +
    `(expires): ${expires}\n` +
    `digest: BLAKE-512=${digest}`;

  const signature = bytesToBase64(
    nacl.sign.detached(
      new TextEncoder().encode(signingString),
      keyPair.secretKey
    )
  );

  return (
    `Signature keyId="${env.ONDC_BAP_ID}|${env.ONDC_UK_ID}|ed25519",` +
    `algorithm="ed25519",created="${created}",expires="${expires}",` +
    `headers="(created) (expires) digest",signature="${signature}"`
  );
}

function getPrivateKey(env) {
  return env.ONDC_SIGNING_PRIVATE_KEY || env.ONDC_PRIVATE_KEY || "";
}

function base64ToBytes(value) {
  const normalized = String(value)
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    throw new HttpError(500, "Signing key is not valid Base64.");
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function assertActionConfig(env) {
  if (!env.ONDC_GATEWAY_URL) {
    throw new HttpError(500, "ONDC_GATEWAY_URL is missing.");
  }
  if (!env.ONDC_BAP_ID || !env.ONDC_BAP_URI) {
    throw new HttpError(500, "ONDC_BAP_ID or ONDC_BAP_URI is missing.");
  }
  if (!env.ONDC_UK_ID) {
    throw new HttpError(500, "ONDC_UK_ID is missing.");
  }
}

function isOnDcPayload(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.context &&
    value.message
  );
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }

  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
