const jsonHeaders = { 'Content-Type': 'application/json' };

export class MarketplaceApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'MarketplaceApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function config(environment) {
  const url = (environment.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    throw new MarketplaceApiError(503, 'SUPABASE_SERVER_NOT_CONFIGURED', 'قاعدة البيانات غير مربوطة بالخادم بعد.');
  }
  return { url, serviceKey };
}

async function readResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    console.error('Supabase server request failed', response.status, body);
    throw new MarketplaceApiError(response.status >= 500 ? 502 : response.status, 'SUPABASE_REQUEST_FAILED', 'تعذر تنفيذ الطلب على قاعدة البيانات.');
  }
  return body;
}

export async function authenticateSupabaseRequest(req, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const authorization = req.headers?.authorization || req.get?.('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new MarketplaceApiError(401, 'AUTH_REQUIRED', 'سجّل الدخول أولًا.');

  const response = await fetchImpl(`${url}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${match[1]}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new MarketplaceApiError(401, 'INVALID_SESSION', 'انتهت جلسة الدخول. سجّل الدخول من جديد.');
  }
  const user = await readResponse(response);
  if (!user?.id) throw new MarketplaceApiError(401, 'INVALID_SESSION', 'جلسة الدخول غير صالحة.');
  return user;
}

export function normalizeOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw new MarketplaceApiError(400, 'INVALID_ITEMS', 'السلة فارغة أو تحتوي عددًا غير صالح من العناصر.');
  }
  return items.map(item => {
    const productId = Number(item?.productId ?? item?.product_id);
    const quantity = Number(item?.quantity);
    const size = typeof item?.size === 'string' && item.size.trim() ? item.size.trim() : null;
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new MarketplaceApiError(400, 'INVALID_ITEM', 'أحد عناصر السلة غير صالح.');
    }
    return { product_id: productId, quantity, size };
  });
}

export async function createMarketplaceOrder({ buyerId, paymentMethod, shippingAddress, items }, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const normalized = normalizeOrderItems(items);
  const method = String(paymentMethod || '').toLowerCase();
  if (!['cash_on_delivery', 'hyperpay', 'card'].includes(method)) {
    throw new MarketplaceApiError(400, 'UNSUPPORTED_PAYMENT_METHOD', 'طريقة الدفع غير مدعومة.');
  }
  const response = await fetchImpl(`${url}/rest/v1/rpc/button_create_order`, {
    method: 'POST',
    headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      p_buyer_id: buyerId,
      p_payment_method: method,
      p_shipping_address: shippingAddress && typeof shippingAddress === 'object' ? shippingAddress : {},
      p_items: normalized,
    }),
  });
  const id = await readResponse(response);
  if (!id || typeof id !== 'string') throw new MarketplaceApiError(502, 'INVALID_ORDER_RESPONSE', 'تم رفض استجابة إنشاء الطلب.');
  return getMarketplaceOrder(id, buyerId, environment, fetchImpl);
}

export async function getMarketplaceOrder(orderId, buyerId, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) throw new MarketplaceApiError(400, 'INVALID_ORDER_ID', 'رقم الطلب غير صالح.');
  const query = new URLSearchParams({
    select: 'id,buyer_id,total,currency,payment_method,payment_status,order_status,provider_reference,shipping_address,created_at,updated_at',
    id: `eq.${orderId}`,
    buyer_id: `eq.${buyerId}`,
    limit: '1',
  });
  const response = await fetchImpl(`${url}/rest/v1/orders?${query}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const rows = await readResponse(response);
  if (!Array.isArray(rows) || !rows.length) throw new MarketplaceApiError(404, 'ORDER_NOT_FOUND', 'الطلب غير موجود.');
  const itemQuery = new URLSearchParams({
    select: 'id,product_id,seller_id,quantity,unit_price,size,product_snapshot,created_at',
    order_id: `eq.${orderId}`,
    order: 'created_at.asc',
  });
  const itemResponse = await fetchImpl(`${url}/rest/v1/order_items?${itemQuery}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const orderItems = await readResponse(itemResponse);
  return { ...rows[0], items: Array.isArray(orderItems) ? orderItems : [] };
}

export async function listBuyerOrders(buyerId, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const query = new URLSearchParams({
    select: 'id,buyer_id,total,currency,payment_method,payment_status,order_status,provider_reference,shipping_address,created_at,updated_at',
    buyer_id: `eq.${buyerId}`, order: 'created_at.desc', limit: '100',
  });
  const response = await fetchImpl(`${url}/rest/v1/orders?${query}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const orders = await readResponse(response);
  if (!Array.isArray(orders) || !orders.length) return [];
  const ids = orders.map(order => order.id).filter(Boolean);
  const itemQuery = new URLSearchParams({
    select: 'id,order_id,product_id,seller_id,quantity,unit_price,size,product_snapshot,created_at',
    order_id: `in.(${ids.join(',')})`, order: 'created_at.asc',
  });
  const itemResponse = await fetchImpl(`${url}/rest/v1/order_items?${itemQuery}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const items = await readResponse(itemResponse);
  const grouped = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
    grouped.get(item.order_id).push(item);
  }

  const refundQuery = new URLSearchParams({
    select: 'id,order_id,status,provider_reference,provider_result_code,attempt_count,processing_started_at,last_error,updated_at',
    order_id: `in.(${ids.join(',')})`, order: 'created_at.desc',
  });
  const refundResponse = await fetchImpl(`${url}/rest/v1/refund_requests?${refundQuery}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const refunds = await readResponse(refundResponse);
  const latestRefund = new Map();
  for (const refund of Array.isArray(refunds) ? refunds : []) {
    if (!latestRefund.has(refund.order_id)) latestRefund.set(refund.order_id, refund);
  }
  return orders.map(order => ({ ...order, items: grouped.get(order.id) || [], refund: latestRefund.get(order.id) || null }));
}

export async function listSellerOrders(accessToken, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const response = await fetchImpl(`${url}/rest/v1/rpc/button_seller_orders`, {
    method: 'POST', headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${accessToken}` }, body: '{}'
  });
  const rows = await readResponse(response);
  return Array.isArray(rows) ? rows : [];
}

export async function setSellerOrderStatus(accessToken, orderId, status, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) throw new MarketplaceApiError(400, 'INVALID_ORDER_ID', 'رقم الطلب غير صالح.');
  const normalized = String(status || '').toLowerCase();
  if (!['confirmed','shipped','delivered','cancelled'].includes(normalized)) throw new MarketplaceApiError(400, 'INVALID_ORDER_STATUS', 'حالة الطلب غير صالحة.');
  const response = await fetchImpl(`${url}/rest/v1/rpc/button_seller_set_order_status`, {
    method: 'POST', headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_order_id: orderId, p_status: normalized })
  });
  return readResponse(response);
}

export async function markOrderPayment(orderId, buyerId, providerReference, status, resultCode = null, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const normalized = String(status || '').toLowerCase();
  if (!['pending','paid','failed'].includes(normalized)) throw new MarketplaceApiError(400, 'INVALID_PAYMENT_STATUS', 'حالة الدفع غير صالحة.');
  const response = await fetchImpl(`${url}/rest/v1/rpc/button_set_order_payment_v2`, {
    method: 'POST', headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ p_order_id: orderId, p_buyer_id: buyerId, p_provider_reference: providerReference, p_status: normalized, p_result_code: resultCode })
  });
  return readResponse(response);
}

export async function cancelBuyerOrder(orderId, buyerId, reason = null, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) throw new MarketplaceApiError(400, 'INVALID_ORDER_ID', 'رقم الطلب غير صالح.');
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null;
  const response = await fetchImpl(`${url}/rest/v1/rpc/button_buyer_cancel_order`, {
    method: 'POST', headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ p_order_id: orderId, p_buyer_id: buyerId, p_reason: cleanReason || null })
  });
  return readResponse(response);
}

export async function getPendingRefund(orderId, buyerId, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const query = new URLSearchParams({ select:'id,order_id,buyer_id,amount,currency,status,provider_reference,provider_result_code,attempt_count,processing_started_at,last_error,reason,created_at,updated_at', order_id:`eq.${orderId}`, buyer_id:`eq.${buyerId}`, status:'in.(pending,processing)', order:'created_at.desc', limit:'1' });
  const response = await fetchImpl(`${url}/rest/v1/refund_requests?${query}`, { headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`} });
  const rows = await readResponse(response);
  if (!Array.isArray(rows) || !rows.length) throw new MarketplaceApiError(404,'REFUND_NOT_FOUND','لا يوجد طلب استرداد معلّق لهذا الطلب.');
  return rows[0];
}

export async function claimRefundProcessing(refundId, orderId, buyerId, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const response = await fetchImpl(`${url}/rest/v1/rpc/button_claim_refund_processing`, {
    method: 'POST', headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ p_refund_id: refundId, p_order_id: orderId, p_buyer_id: buyerId }),
  });
  return readResponse(response);
}

export async function recordRefundProcessing(refundId, orderId, buyerId, status, providerReference = null, resultCode = null, lastError = null, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const normalized = String(status || '').toLowerCase();
  if (!['pending', 'processing'].includes(normalized)) throw new MarketplaceApiError(400, 'INVALID_REFUND_STATUS', 'حالة الاسترداد غير صالحة.');
  const response = await fetchImpl(`${url}/rest/v1/rpc/button_record_refund_processing`, {
    method: 'POST', headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      p_refund_id: refundId, p_order_id: orderId, p_buyer_id: buyerId, p_status: normalized,
      p_provider_reference: providerReference || null, p_result_code: resultCode || null, p_last_error: lastError || null,
    }),
  });
  return readResponse(response);
}

export async function finalizeRefundV2(refundId, orderId, buyerId, succeeded, providerReference, resultCode = null, environment = process.env, fetchImpl = fetch) {
  const { url, serviceKey } = config(environment);
  const response = await fetchImpl(`${url}/rest/v1/rpc/button_finalize_refund_v2`, {
    method: 'POST', headers: { ...jsonHeaders, apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      p_refund_id: refundId, p_order_id: orderId, p_buyer_id: buyerId, p_succeeded: Boolean(succeeded),
      p_provider_reference: providerReference || null, p_result_code: resultCode || null,
    }),
  });
  return readResponse(response);
}

// Compatibility for update 12 callers. New code uses finalizeRefundV2 so result codes are audited.
export async function finalizeRefund(refundId, orderId, buyerId, succeeded, providerReference, environment = process.env, fetchImpl = fetch) {
  return finalizeRefundV2(refundId, orderId, buyerId, succeeded, providerReference, null, environment, fetchImpl);
}
