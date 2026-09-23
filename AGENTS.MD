# ARCHITECTURE & OPERATIONAL RULES: STOREFRONT AI SHOPPING CONCIERGE

> **CRITICAL ENFORCEMENT NOTICE**
> These rules are absolute and must be obeyed across all prompts, edits, deployments, and implementations.
> NEVER violate or deviate from these rules.

---

## 1. STRICT ZERO-FALLBACK PROTOCOL (ABSOLUTE)

- **ZERO BYOK Fallbacks:**
  When a merchant configures Bring-Your-Own-Key (OpenAI or Gemini), the system MUST strictly execute on their key. If the key is invalid, missing, or rate-limited, it must throw immediately.
  **NEVER silently fall back to platform keys or consume platform credits.**

- **ZERO Developer / Personal Email Fallbacks:**
  Personal developer emails are STRICTLY FORBIDDEN anywhere in code, configuration, or fallbacks.
  Alerts must route EXCLUSIVELY to the merchant's verified store email.

- **ZERO Third-Party / External Fetch Fallbacks:**
  Email sending is handled natively by Cloudflare's `env.EMAIL.send` binding.
  **NEVER call external email APIs (such as Resend / `api.resend.com`) as fallbacks.**

- **ZERO Customer-Facing Errors:**
  Shoppers on the storefront MUST NEVER see error popups, stack traces, system prompts, or API key configuration messages.
  If an error occurs, the customer UI silently clears the typing indicator. Errors are logged to D1 `error_logs` and dispatched privately to the merchant's alert email.

---

## 2. SHOPIFY MERCHANT ONBOARDING & SINGLE SOURCE OF TRUTH

- **Shopify Provides Everything at Install:**
  Do NOT prompt the merchant for basic store details or fetch from external services.
  At installation and inside App Home (`authenticate.admin(request)`), Shopify provides:
  - `session.shop` (e.g., `facetimefy.myshopify.com`)
  - `session.accessToken` (Offline Admin API token)
  - Verified merchant email via Admin GraphQL:
    ```graphql
    query getShopContact {
      shop {
        email          # Store owner email
        contactEmail   # Operational contact / alert email
        name           # Store brand name
        myshopifyDomain# Permanent unique store identifier
      }
    }
    ```
- **App Home (`app/routes/app._index.jsx`):**
  - Built with Shopify Polaris web components (`<s-page>`, `<s-section>`, `<s-stack>`, `<s-button>`).
  - Autofills the alert email directly from Shopify's `contactEmail || email`.
  - Syncs merchant settings (provider, model, API key, notification email) directly to the Cloudflare Worker `/admin/settings` endpoint.

---

## 3. CLOUDFLARE EDGE INFRASTRUCTURE

| Component | Resource / ID | Purpose |
| :--- | :--- | :--- |
| **Worker** | `shop-chat-agent-worker` (`https://shop-chat-agent-worker.avi-kay2019.workers.dev`) | Production Edge API (Pure JSON, Zero SSE). |
| **Email Service** | `env.EMAIL` (`error@urgent.facetimefy.com`) | Cloudflare Native Email Sending with `"remote": true` in `wrangler.jsonc`. |
| **D1 Database** | `facetimefy` (`a6b8ed18-b53f-4494-8e5a-443798cf6eb5`) | Relational persistence (`merchants`, `conversations`, `error_logs`). |
| **R2 Storage** | `shop-chat-conversations` | Complete conversation JSON transcripts: `conversations/{shop}/{conversation_id}.json`. |
| **Analytics Engine** | `shop_chat_analytics` (`ANALYTICS_ENGINE_CHAT`) | Edge telemetry: latency, turn counts, model provider, and status (`success` / `error`). |
| **KV Cache** | `MERCHANT_SETTINGS` & `CHAT_HISTORY` | Ultra-fast edge lookups for per-shop configuration and active conversation memory. |

---

## 4. D1 DATABASE SCHEMA (`facetimefy`)

```sql
-- Merchants Table (BYOK & Notification Config)
CREATE TABLE IF NOT EXISTS merchants (
  shop TEXT PRIMARY KEY,
  notification_email TEXT,
  provider TEXT DEFAULT 'openai',
  model TEXT DEFAULT 'gpt-5.5',
  api_key TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversations Index Table
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  r2_key TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Error Logs Table (Diagnostics)
CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  conversation_id TEXT,
  user_message TEXT,
  error TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI Assisted Sales & Recommendations
CREATE TABLE IF NOT EXISTS ai_assisted_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_title TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0.0,
  event_type TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customer Demand & Unmet Opportunities
CREATE TABLE IF NOT EXISTS customer_demand_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  customer_query TEXT NOT NULL,
  category TEXT NOT NULL,
  matched_items_count INTEGER DEFAULT 0,
  outcome TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. STOREFRONT APP EXTENSION

- **Liquid Embed (`extensions/chat-bubble/blocks/chat-interface.liquid`):**
  - Resolves `{{ shop.permanent_domain }}` and `{{ shop.domain }}` directly from Liquid context.
  - Points to production Cloudflare Worker endpoint.
- **Client Script (`extensions/chat-bubble/assets/chat.js`):**
  - Pure JSON request/response over standard `fetch` (Zero SSE).
  - Handles `/cart/add.js` for seamless native Shopify cart operations.
  - Silently catches errors without polluting the shopper DOM.