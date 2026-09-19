const jsonHeaders = { 'Content-Type': 'application/json' };

export class MarketplaceApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'MarketplaceApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function marketplaceConfiguration(environment = process.env) {
  const url = (environment.SUPABASE_URL || '').replace(/\/$/, '');
  const publicKey = environment.SUPABASE_PUBLISHABLE_KEY || environment.SUPABASE_ANON_KEY || '';
  const adminKey = environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY || '';
  const backendSecret = environment.BUTTON_BACKEND_SHARED_SECRET || '';
  const clientKey = publicKey || adminKey;
  const sharedBackendConfigured = Boolean(publicKey && backendSecret);
  return {
    url, publicKey, adminKey, backendSecret, clientKey, sharedBackendConfigured,
    marketplaceConfigured: Boolean(url && clientKey),
    marketplaceAdminConfigured: Boolean(url && (adminKey || sharedBackendConfigured)),
  };
}

function userConfig(environment) {
  const config = marketplaceConfiguration(environment);
  if (!config.url || !config.clientKey) throw new MarketplaceApiError(503, 'SUPABASE_SERVER_NOT_CONFIGURED', 'قاعدة البيانات غير مربوطة بالخادم بعد.');
  return config;
}
function adminConfig(environment) {
  const config = marketplaceConfiguration(environment);
  if (!config.url || (!config.adminKey && !config.sharedBackendConfigured)) throw new MarketplaceApiError(503, 'SUPABASE_ADMIN_NOT_CONFIGURED', 'إعداد العمليات الخادمية الحساسة غير متوفر بعد.');
  return config;
}
function isLegacyJwtKey(value) { return String(value || '').split('.').length === 3; }
export function supabaseAdminHeaders(adminKey, extra = {}) {
  const headers = { ...extra, apikey: adminKey };
  if (isLegacyJwtKey(adminKey)) headers.Authorization = `Bearer ${adminKey}`;
  return headers;
}
export function supabaseBackendHeaders(publicKey, backendSecret, extra = {}) {
  if (!publicKey || !backendSecret) throw new MarketplaceApiError(503, 'SUPABASE_ADMIN_NOT_CONFIGURED', 'إعداد العمليات الخادمية الحساسة غير متوفر بعد.');
  return { ...extra, apikey: publicKey, 'x-button-backend-key': backendSecret };
}
function privilegedRequest(config, directRpc, backendRpc, extra = {}) {
  if (config.adminKey) return { endpoint: directRpc, headers: supabaseAdminHeaders(config.adminKey, extra), mode: 'admin_key' };
  return { endpoint: backendRpc, headers: supabaseBackendHeaders(config.publicKey, config.backendSecret, extra), mode: 'shared_secret' };
}
export function supabaseUserHeaders(apiKey, accessToken, extra = {}) {
  if (!accessToken) throw new MarketplaceApiError(401, 'AUTH_REQUIRED', 'سجّل الدخول أولًا.');
  return { ...extra, apikey: apiKey, Authorization: `Bearer ${accessToken}` };
}
async function readResponse(response) {
  const text = await response.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    console.error('Supabase server request failed', response.status, body);
    throw new MarketplaceApiError(response.status >= 500 ? 502 : response.status, 'SUPABASE_REQUEST_FAILED', 'تعذر تنفيذ الطلب على قاعدة البيانات.');
  }
  return body;
}
function requestAccessToken(req) {
  const authorization = req.headers?.authorization || req.get?.('authorization') || '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || '';
}
export async function authenticateSupabaseRequest(req, environment = process.env, fetchImpl = fetch) {
  const { url, clientKey } = userConfig(environment); const accessToken = requestAccessToken(req);
  if (!accessToken) throw new MarketplaceApiError(401, 'AUTH_REQUIRED', 'سجّل الدخول أولًا.');
  const response = await fetchImpl(`${url}/auth/v1/user`, { headers: supabaseUserHeaders(clientKey, accessToken) });
  if (response.status === 401 || response.status === 403) throw new MarketplaceApiError(401, 'INVALID_SESSION', 'انتهت جلسة الدخول. سجّل الدخول من جديد.');
  const user = await readResponse(response);
  if (!user?.id) throw new MarketplaceApiError(401, 'INVALID_SESSION', 'جلسة الدخول غير صالحة.');
  return user;
}
export function normalizeOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new MarketplaceApiError(400, 'INVALID_ITEMS', 'السلة فارغة أو تحتوي عددًا غير صالح من العناصر.');
  return items.map(item => {
    const productId = Number(item?.productId ?? item?.product_id); const quantity = Number(item?.quantity);
    const size = typeof item?.size === 'string' && item.size.trim() ? item.size.trim() : null;
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new MarketplaceApiError(400, 'INVALID_ITEM', 'أحد عناصر السلة غير صالح.');
    return { product_id: productId, quantity, size };
  });
}
export async function createMarketplaceOrder({ buyerId, accessToken, paymentMethod, shippingAddress, items }, environment = process.env, fetchImpl = fetch) {
  const config = userConfig(environment); const normalized = normalizeOrderItems(items); const method = String(paymentMethod || '').toLowerCase();
  if (!['cash_on_delivery', 'hyperpay', 'card'].includes(method)) throw new MarketplaceApiError(400, 'UNSUPPORTED_PAYMENT_METHOD', 'طريقة الدفع غير مدعومة.');
  const extraHeaders = { ...jsonHeaders };
  if (['hyperpay', 'card'].includes(method)) {
    if (!config.publicKey || !config.backendSecret) throw new MarketplaceApiError(503, 'SUPABASE_ADMIN_NOT_CONFIGURED', 'إنشاء طلبات الدفع الإلكتروني يتطلب قناة خادمية آمنة.');
    extraHeaders['x-button-backend-key'] = config.backendSecret;
  }
  const response = await fetchImpl(`${config.url}/rest/v1/rpc/button_create_order`, {
    method: 'POST', headers: supabaseUserHeaders(config.clientKey, accessToken, extraHeaders),
    body: JSON.stringify({ p_buyer_id: buyerId, p_payment_method: method, p_shipping_address: shippingAddress && typeof shippingAddress === 'object' ? shippingAddress : {}, p_items: normalized }),
  });
  const id = await readResponse(response);
  if (!id || typeof id !== 'string') throw new MarketplaceApiError(502, 'INVALID_ORDER_RESPONSE', 'تم رفض استجابة إنشاء الطلب.');
  return getMarketplaceOrder(id, buyerId, accessToken, environment, fetchImpl);
}

export async function getMarketplaceOrder(orderId, buyerId, accessToken, environment = process.env, fetchImpl = fetch) {
  const { url, clientKey } = userConfig(environment);
  if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) throw new MarketplaceApiError(400, 'INVALID_ORDER_ID', 'رقم الطلب غير صالح.');
  const query = new URLSearchParams({ select:'id,buyer_id,total,currency,payment_method,payment_status,order_status,provider_reference,shipping_address,created_at,updated_at', id:`eq.${orderId}`, buyer_id:`eq.${buyerId}`, limit:'1' });
  const headers = supabaseUserHeaders(clientKey, accessToken); const response = await fetchImpl(`${url}/rest/v1/orders?${query}`, { headers }); const rows = await readResponse(response);
  if (!Array.isArray(rows) || !rows.length) throw new MarketplaceApiError(404, 'ORDER_NOT_FOUND', 'الطلب غير موجود.');
  const itemQuery = new URLSearchParams({ select:'id,product_id,seller_id,quantity,unit_price,size,product_snapshot,created_at', order_id:`eq.${orderId}`, order:'created_at.asc' });
  const itemResponse = await fetchImpl(`${url}/rest/v1/order_items?${itemQuery}`, { headers }); const orderItems = await readResponse(itemResponse);
  return { ...rows[0], items: Array.isArray(orderItems) ? orderItems : [] };
}
export async function listBuyerOrders(buyerId, accessToken, environment = process.env, fetchImpl = fetch) {
  const { url, clientKey } = userConfig(environment); const query = new URLSearchParams({ select:'id,buyer_id,total,currency,payment_method,payment_status,order_status,provider_reference,shipping_address,created_at,updated_at', buyer_id:`eq.${buyerId}`, order:'created_at.desc', limit:'100' });
  const headers = supabaseUserHeaders(clientKey, accessToken); const response = await fetchImpl(`${url}/rest/v1/orders?${query}`, { headers }); const orders = await readResponse(response);
  if (!Array.isArray(orders) || !orders.length) return [];
  const ids = orders.map(order => order.id).filter(Boolean); const itemQuery = new URLSearchParams({ select:'id,order_id,product_id,seller_id,quantity,unit_price,size,product_snapshot,created_at', order_id:`in.(${ids.join(',')})`, order:'created_at.asc' });
  const itemResponse = await fetchImpl(`${url}/rest/v1/order_items?${itemQuery}`, { headers }); const items = await readResponse(itemResponse); const grouped = new Map();
  for (const item of Array.isArray(items) ? items : []) { if (!grouped.has(item.order_id)) grouped.set(item.order_id, []); grouped.get(item.order_id).push(item); }
  const refundQuery = new URLSearchParams({ select:'id,order_id,status,provider_reference,provider_result_code,attempt_count,processing_started_at,last_error,updated_at', order_id:`in.(${ids.join(',')})`, order:'created_at.desc' });
  const refundResponse = await fetchImpl(`${url}/rest/v1/refund_requests?${refundQuery}`, { headers }); const refunds = await readResponse(refundResponse); const latestRefund = new Map();
  for (const refund of Array.isArray(refunds) ? refunds : []) if (!latestRefund.has(refund.order_id)) latestRefund.set(refund.order_id, refund);
  return orders.map(order => ({ ...order, items: grouped.get(order.id) || [], refund: latestRefund.get(order.id) || null }));
}
export async function listSellerOrders(accessToken, environment = process.env, fetchImpl = fetch) {
  const { url, clientKey } = userConfig(environment); const response = await fetchImpl(`${url}/rest/v1/rpc/button_seller_orders`, { method:'POST', headers:supabaseUserHeaders(clientKey, accessToken, jsonHeaders), body:'{}' }); const rows = await readResponse(response); return Array.isArray(rows) ? rows : [];
}
export async function setSellerOrderStatus(accessToken, orderId, status, environment = process.env, fetchImpl = fetch) {
  const { url, clientKey } = userConfig(environment); if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) throw new MarketplaceApiError(400, 'INVALID_ORDER_ID', 'رقم الطلب غير صالح.');
  const normalized=String(status||'').toLowerCase(); if(!['confirmed','shipped','delivered','cancelled'].includes(normalized)) throw new MarketplaceApiError(400,'INVALID_ORDER_STATUS','حالة الطلب غير صالحة.');
  const response=await fetchImpl(`${url}/rest/v1/rpc/button_seller_set_order_status`,{method:'POST',headers:supabaseUserHeaders(clientKey,accessToken,jsonHeaders),body:JSON.stringify({p_order_id:orderId,p_status:normalized})}); return readResponse(response);
}
export async function cancelBuyerOrder(orderId,buyerId,reason,accessToken,environment=process.env,fetchImpl=fetch){const{url,clientKey}=userConfig(environment);const response=await fetchImpl(`${url}/rest/v1/rpc/button_buyer_cancel_order`,{method:'POST',headers:supabaseUserHeaders(clientKey,accessToken,jsonHeaders),body:JSON.stringify({p_order_id:orderId,p_buyer_id:buyerId,p_reason:typeof reason==='string'?reason.slice(0,500):null})});return readResponse(response);}
export async function markOrderPayment(orderId,buyerId,providerReference,status,resultCode,environment=process.env,fetchImpl=fetch){const config=adminConfig(environment);const req=privilegedRequest(config,'button_set_order_payment_v2','button_backend_set_order_payment_v2',jsonHeaders);const response=await fetchImpl(`${config.url}/rest/v1/rpc/${req.endpoint}`,{method:'POST',headers:req.headers,body:JSON.stringify({p_order_id:orderId,p_buyer_id:buyerId,p_provider_reference:providerReference,p_status:status,p_result_code:resultCode})});return readResponse(response);}
export async function getPendingRefund(orderId,buyerId,environment=process.env,fetchImpl=fetch){const config=adminConfig(environment);const req=privilegedRequest(config,'button_get_pending_refund','button_backend_get_pending_refund',jsonHeaders);const response=await fetchImpl(`${config.url}/rest/v1/rpc/${req.endpoint}`,{method:'POST',headers:req.headers,body:JSON.stringify({p_order_id:orderId,p_buyer_id:buyerId})});const rows=await readResponse(response);if(!Array.isArray(rows)||!rows.length)throw new MarketplaceApiError(404,'REFUND_NOT_FOUND','طلب الاسترداد غير موجود.');return rows[0];}
export async function claimRefundProcessing(refundId,orderId,buyerId,environment=process.env,fetchImpl=fetch){const config=adminConfig(environment);const req=privilegedRequest(config,'button_claim_refund_processing','button_backend_claim_refund_processing',jsonHeaders);const response=await fetchImpl(`${config.url}/rest/v1/rpc/${req.endpoint}`,{method:'POST',headers:req.headers,body:JSON.stringify({p_refund_id:refundId,p_order_id:orderId,p_buyer_id:buyerId})});return readResponse(response);}
export async function recordRefundProcessing(refundId,orderId,buyerId,status,providerReference,resultCode,lastError,environment=process.env,fetchImpl=fetch){const config=adminConfig(environment);const req=privilegedRequest(config,'button_record_refund_processing','button_backend_record_refund_processing',jsonHeaders);const response=await fetchImpl(`${config.url}/rest/v1/rpc/${req.endpoint}`,{method:'POST',headers:req.headers,body:JSON.stringify({p_refund_id:refundId,p_order_id:orderId,p_buyer_id:buyerId,p_status:status,p_provider_reference:providerReference,p_result_code:resultCode,p_last_error:lastError})});return readResponse(response);}
export async function finalizeRefundV2(refundId,orderId,buyerId,succeeded,providerReference,resultCode,environment=process.env,fetchImpl=fetch){const config=adminConfig(environment);const req=privilegedRequest(config,'button_finalize_refund_v2','button_backend_finalize_refund_v2',jsonHeaders);const response=await fetchImpl(`${config.url}/rest/v1/rpc/${req.endpoint}`,{method:'POST',headers:req.headers,body:JSON.stringify({p_refund_id:refundId,p_order_id:orderId,p_buyer_id:buyerId,p_succeeded:Boolean(succeeded),p_provider_reference:providerReference,p_result_code:resultCode})});return readResponse(response);}
