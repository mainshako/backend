// Server-only payment provider boundary. Browser claims are never trusted.
export class PaymentProviderError extends Error {
  constructor(code, message, statusCode = 503) { super(message); this.name='PaymentProviderError'; this.code=code; this.statusCode=statusCode; }
}
const unavailable = (name,code,message) => Object.freeze({name,ready:false,createPayment:async()=>{throw new PaymentProviderError(code,message)},verifyPayment:async()=>{throw new PaymentProviderError(code,message)},refundPayment:async()=>{throw new PaymentProviderError(code,message)}});
const SUCCESS_RESULT = /^(000\.000\.|000\.100\.1|000\.[36])/;
const PENDING_RESULT = /^(000\.200)/;
const HYPERPAY_SANDBOX_ORIGIN = 'https://eu-test.oppwa.com';
const CURRENCY = /^[A-Z]{3}$/;
const MERCHANT_TRANSACTION_ID = /^[A-Za-z0-9._-]{1,200}$/;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
function normalizedCurrency(currency) {
  const value=String(currency||'').trim().toUpperCase();
  if(!CURRENCY.test(value)) throw new PaymentProviderError('INVALID_PAYMENT_CURRENCY','عملة الدفع غير صالحة.',400);
  return value;
}
function normalizedAmount(amount, code, message) {
  const value=Number(amount);
  if(!Number.isFinite(value)||value<=0) throw new PaymentProviderError(code,message,400);
  const fixed=value.toFixed(2);
  if(Number(fixed)<=0) throw new PaymentProviderError(code,message,400);
  return fixed;
}
function hyperPayProvider(env, fetchImpl=fetch) {
  const base=(env.HYPERPAY_BASE_URL || HYPERPAY_SANDBOX_ORIGIN).replace(/\/$/,'');
  const token=env.HYPERPAY_ACCESS_TOKEN || '';
  const entityId=env.HYPERPAY_ENTITY_ID || '';
  const enabled=String(env.HYPERPAY_ENABLED||'').toLowerCase()==='true';
  if (base !== HYPERPAY_SANDBOX_ORIGIN) return unavailable('hyperpay','HYPERPAY_SANDBOX_REQUIRED','HyperPay مقيد حاليًا ببيئة Sandbox فقط. لم يتم إرسال أي طلب دفع.');
  if (!enabled || !token || !entityId) return unavailable('hyperpay','HYPERPAY_NOT_CONFIGURED','HyperPay غير مفعّل أو بيانات الربط غير مكتملة. لم يتم خصم أي مبلغ.');
  const request=async(url,options={})=>{ const r=await fetchImpl(url,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}}); const contentLength=Number(r.headers?.get?.('content-length')); if(Number.isFinite(contentLength)&&contentLength>MAX_PROVIDER_RESPONSE_BYTES) throw new PaymentProviderError('HYPERPAY_RESPONSE_TOO_LARGE','استجابة بوابة الدفع أكبر من الحد الآمن.',502); let raw; try{raw=await r.text()}catch{raw=''} if(Buffer.byteLength(raw,'utf8')>MAX_PROVIDER_RESPONSE_BYTES) throw new PaymentProviderError('HYPERPAY_RESPONSE_TOO_LARGE','استجابة بوابة الدفع أكبر من الحد الآمن.',502); let b; try{b=JSON.parse(raw)}catch{b=null} if(!r.ok||!b) throw new PaymentProviderError('HYPERPAY_REQUEST_FAILED','تعذر الاتصال ببوابة الدفع.',502); return b; };
  return Object.freeze({ name:'hyperpay', ready:true,
    async createPayment({amount,currency='ILS',merchantTransactionId}) {
      const amountValue=normalizedAmount(amount,'INVALID_PAYMENT_AMOUNT','قيمة الدفع غير صالحة.');
      const currencyCode=normalizedCurrency(currency);
      const transactionId=String(merchantTransactionId||'').trim();
      if(!MERCHANT_TRANSACTION_ID.test(transactionId)) throw new PaymentProviderError('INVALID_MERCHANT_TRANSACTION_ID','مرجع الطلب غير صالح للدفع.',400);
      const form=new URLSearchParams({entityId,amount:amountValue,currency:currencyCode,paymentType:'DB',merchantTransactionId:transactionId});
      const body=await request(`${base}/v1/checkouts`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
      if(!body.id) throw new PaymentProviderError('HYPERPAY_INVALID_RESPONSE','بوابة الدفع لم تُرجع جلسة دفع صالحة.',502);
      return {checkoutId:body.id, providerReference:body.id};
    },
    async refundPayment({paymentId,amount,currency='ILS'}) {
      if(!/^[A-Za-z0-9._-]{8,200}$/.test(String(paymentId||''))) throw new PaymentProviderError('INVALID_PAYMENT_ID','مرجع عملية الدفع غير صالح.',400);
      const amountValue=normalizedAmount(amount,'INVALID_REFUND_AMOUNT','قيمة الاسترداد غير صالحة.');
      const currencyCode=normalizedCurrency(currency);
      const form=new URLSearchParams({entityId,amount:amountValue,currency:currencyCode,paymentType:'RF'});
      const body=await request(`${base}/v1/payments/${encodeURIComponent(paymentId)}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
      const code=String(body?.result?.code||'');
      return { succeeded:SUCCESS_RESULT.test(code), pending:PENDING_RESULT.test(code), resultCode:code, providerReference:body?.id||paymentId, rawStatus:body?.result?.description||'' };
    },
    async verifyPayment({checkoutId}) {
      if(!/^[A-Za-z0-9._-]{8,200}$/.test(String(checkoutId||''))) throw new PaymentProviderError('INVALID_CHECKOUT_ID','معرّف عملية الدفع غير صالح.',400);
      const body=await request(`${base}/v1/checkouts/${encodeURIComponent(checkoutId)}/payment?entityId=${encodeURIComponent(entityId)}`);
      const code=String(body?.result?.code||'');
      return { paid:SUCCESS_RESULT.test(code), pending:PENDING_RESULT.test(code), resultCode:code, providerReference:body?.id||checkoutId, rawStatus:body?.result?.description||'' };
    }
  });
}
export function getPaymentProvider(environment=process.env, fetchImpl=fetch) {
  const name=(environment.PAYMENT_PROVIDER||'disabled').trim().toLowerCase();
  if(name==='disabled') return unavailable('disabled','PAYMENT_PROVIDER_DISABLED','الدفع الإلكتروني غير مفعّل حاليًا. لم يتم خصم أي مبلغ أو تأكيد الدفع.');
  if(name==='hyperpay') return hyperPayProvider(environment,fetchImpl);
  throw new PaymentProviderError('PAYMENT_PROVIDER_UNSUPPORTED','مزود الدفع المحدد غير متاح حاليًا.');
}