/**
 * ucpDiscovery.ts - Universal Commerce Protocol (UCP) Auto-Discovery
 *
 * Automatically inspects the current website for `/.well-known/ucp`
 * to extract:
 *  1. Store's native MCP endpoint (e.g. https://...myshopify.com/api/ucp/mcp)
 *  2. Merchant identity (e.g. TaTTTy)
 *  3. Supported capabilities (catalog, cart, checkout, discount, fulfillment)
 *  4. Native payment handlers (Shop Pay, Google Pay, Card)
 */

export interface DiscoveredUcpStore {
  ucpVersion: string;
  mcpEndpoint: string;
  merchantName: string;
  merchantOrigin: string;
  shopId?: string;
  capabilities: string[];
  paymentHandlers: {
    shopPay?: boolean;
    shopId?: string;
    googlePay?: boolean;
    card?: boolean;
  };
}

const DEFAULT_MCP_ENDPOINT = 'https://master-group-mcp.anigok.com/mcp';

export async function discoverUcpStore(origin?: string): Promise<DiscoveredUcpStore | null> {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!base) return null;

  const urlsToTry = [
    `${base}/.well-known/ucp`,
    `${base}/.well-known/ucp.json`,
  ];

  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        mode: 'cors',
      });
      if (!res.ok) continue;

      const data = await res.json();
      const ucp = data?.ucp;
      if (!ucp) continue;

      // 1. Extract MCP service
      const shoppingServices = ucp.services?.['dev.ucp.shopping'] || [];
      const mcpService = shoppingServices.find((s: any) => s.transport === 'mcp');
      const endpoint = mcpService?.endpoint || DEFAULT_MCP_ENDPOINT;

      // 2. Extract Merchant info
      const gpayMerchant = ucp.payment_handlers?.['com.google.pay']?.[0]?.config?.merchant_info;
      const merchantName = gpayMerchant?.merchant_name 
        || (typeof document !== 'undefined' ? document.title.split(/[-|–]/)[0].trim() : '') 
        || (typeof window !== 'undefined' ? window.location.hostname : 'Store');
      const merchantOrigin = gpayMerchant?.merchant_origin 
        || (typeof window !== 'undefined' ? window.location.hostname : '');

      // 3. Extract Shop Pay ID
      const shopPayConfig = ucp.payment_handlers?.['dev.shopify.shop_pay']?.[0]?.config;
      const shopId = shopPayConfig?.shop_id;

      // 4. Extract capabilities
      const capabilities = Object.keys(ucp.capabilities || {});

      // 5. Payment handlers
      const paymentHandlers = {
        shopPay: !!ucp.payment_handlers?.['dev.shopify.shop_pay'],
        shopId,
        googlePay: !!ucp.payment_handlers?.['com.google.pay'],
        card: !!ucp.payment_handlers?.['dev.shopify.card'],
      };

      return {
        ucpVersion: ucp.version || '2026-08-25',
        mcpEndpoint: endpoint,
        merchantName,
        merchantOrigin,
        shopId,
        capabilities,
        paymentHandlers,
      };
    } catch (e) {
      // Continue to next URL or fallback
    }
  }

  return null;
}
