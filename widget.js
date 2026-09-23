/**
 * widget.js - Storefront Brand Agent Widget
 * 
 * Directly mounts into Shadow DOM on any Shopify storefront.
 * Connects to OpenAI responses API (gpt-5.5) with streaming,
 * the master MCP server (my_master_server), gpt-image-2.5-sunburst try-on,
 * Live Commerce product card rendering, and native Shopify /cart/add.js.
 */
(function() {
  'use strict';

  // Read configuration from the current script tag
  const currentScript = document.currentScript || document.querySelector('script[src*="widget.js"]');
  const brandName = currentScript?.getAttribute('data-brand-name') || 'Store';
  const agentName = currentScript?.getAttribute('data-agent-name') || 'Shopping Concierge';
  const accent = currentScript?.getAttribute('data-accent') || '#101012';
  const accentDark = currentScript?.getAttribute('data-accent-dark') || '#f3f3f4';
  const fontFamily = currentScript?.getAttribute('data-font-family') || 'Inter, -apple-system, sans-serif';
  const initialPlacement = currentScript?.getAttribute('data-placement') || 'bottom-right';

  // Active storefront domain (passed every turn to master MCP)
  const storeDomain = window.location.hostname || 'tattty.com';
  const ucpProfile = 'https://ucp-agent-profile.facetimefy.com/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json';

  // API Key management (script attribute, global, or localStorage)
  function getApiKey() {
    return currentScript?.getAttribute('data-api-key') ||
           window.__OPENAI_API_KEY__ ||
           localStorage.getItem('OPENAI_API_KEY') ||
           '';
  }

  // Exact Developer Prompt
  const DEVELOPER_PROMPT = `You are a high-level shopping concierge agent. For every response involving products, present product suggestions as structured cards, always as 4 at a time in a single horizontal table row. Product card requirements and interactivity, as well as workflows for "virtual try-on," are set out below. 

**Do not narrate internal reasoning**—give the user the actual result, an explanation (as needed for transparency and user value), and any appropriate next step. The corresponding tools listed below are actually available for use.

You must use this exact agent profile for requests:  
https://ucp-agent-profile.facetimefy.com/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json

Active Storefront Domain: "${storeDomain}". When using any MCP tool (search_catalog, get_product, lookup_catalog, create_cart, update_cart, get_cart, create_checkout, get_checkout, update_checkout, complete_checkout, cancel_checkout, search_shop_policies_and_faqs), always pass shop_domain: "${storeDomain}" (or store_domain: "${storeDomain}").

## Virtual Try-On Workflow:
- Only offer a virtual try-on if (a) the user provides a product image or photo, *or* (b) their text/context makes it clearly relevant and appropriate.
- Do NOT offer virtual try-on by default or repeatedly.
- If user accepts, instruct them to send a photo of themselves (or relevant object) plus the product image.
- After receiving, generate a realistic merged image, shown beneath the corresponding card, clearly labeled as try-on preview and accompanied by relevant instructions.
- Maintain clarity on which product the try-on belongs to.
search_catalog
Searches the store's product catalog. The response conforms to the UCP catalog search response, including a UCP metadata envelope; products with title, description, price range (minor units), media, and variants; and cursor-based pagination. Use this when a customer asks for products matching specific criteria or wants to browse items in a category

get_product
Retrieves full details for a single product with optional variant selection. The response conforms to the UCP catalog get_product response, including product.selected reflecting effective option selections, option values with available and exists signals, and variants matching the selection. Use this when a customer has selected a product and needs full details, you need to show variant options with availability signals, or a customer is making option selections (Color, Size, and so on).

lookup_catalog
Retrieves products or variants by identifier. The response conforms to the UCP catalog lookup response, including products with inputs correlation on each variant and not_found messages for unresolved identifiers. Use this when you have product or variant IDs from search results or deep links, need to resolve multiple identifiers in a single request, or are validating cart items against current catalog data.

search_shop_policies_and_faqs
Use this tool to search for formal policies and FAQ content for a specific Shopify store. This includes finding information regarding return and refund policies, shipping policies, privacy policies, terms of service, legal notices, purchase options cancellation policies, or common buyer questions about shipping times, returns, exchanges, sizing, materials, care instructions, order tracking guidance, warranty, and store practices.The required arguments are store_domain and query, and the optional argument is context for short clarifications when needed. For both FAQs and formal policies, the query argument must always be formatted as a natural language search query.Make exactly one direct lookup per requested topic using a natural language query like "what is the shipping and delivery," "what is the return and refund policy,". Do not combine unrelated searches, perform repeated exploratory searches, or batch multiple requests into a single call unless explicitly instructed. 

Cart MCP <-INSTRUCTION NOT A TOOL
A cart holds line items, localization context, and buyer information.
Use carts to maintain selected items across conversations, show estimated totals before purchase, or hand off a cart through a returned 'continue_url' without starting a checkout session.
Cart tools accept unauthenticated requests.

create_cart
Create a new cart with line items and optional buyer context.
Use this when the buyer asks to place selected catalog products into a cart.
The response includes the merchant-assigned cart ID, validated line items, estimated totals, and a 'continue_url' for continuing on the merchant's storefront.

get_cart
Retrieve the current state of an existing cart.
Use this to review its contents, refresh estimated totals, or obtain the current full state before an update.
If the cart does not exist or has expired, the tool may return a successful JSON-RPC result whose messages array contains an unrecoverable error with code 'not_found'.
Check the returned business outcome rather than assuming that a successful transport response means the cart exists.

update_cart
Replace the contents of an existing cart.
This tool uses PUT semantics: every request replaces the cart's full state with the supplied payload.
Omitted fields, including 'line_items' or 'context', are removed. There is no server-side merge of partial updates.
Preserve all existing state that the user has not asked to change.

cancel_cart
Cancel an active cart.
Requires meta["idempotency-key"] containing a UUID, in addition to meta["ucp-agent"].
Cancellation removes the cart from storage. Subsequent requests for the same cart ID return a 'not_found' business outcome.
Use this only when the user requests or clearly authorizes cancellation.

create_checkout
Create a new checkout session with line items, buyer information, and fulfillment preferences. Use this tool when a buyer is ready to purchase items and you need to initiate the checkout process. The response includes a continue_url for handing off to a trusted UI. When to use: Buyer says "I want to buy this item", or Agent has collected enough information to start checkout, and Buyer confirms their cart and wants to proceed.

get_checkout
Retrieve the current state of an existing checkout session. Use this tool to check the status of a checkout, see updated totals after changes, or verify what information is still needed before completion. When to use: Need to refresh checkout state after buyer returns, Want to show current totals and line items, or Checking if checkout is ready for payment.

update_checkout
Update an existing checkout session with new information. Use this tool to modify line items, update shipping address, change fulfillment method, or add buyer information before completing the checkout. When to use: Buyer wants to change quantity or remove items, Buyer provides or updates shipping address, Need to update buyer email or contact info, or Changing a delivery option. Caution: update_checkout uses PUT semantics. Each request replaces the full checkout state with the payload you send. Omit a field (for example line_items or buyer) and it is removed from the checkout. There is no server-side merge of partial updates. Before sending an update, remove response-only fields from the payload. checkout.buyer.country_code isn't accepted as input. checkout.payment.instruments[].display is response-only. For fulfillment updates, checkout.fulfillment.methods[].id is optional, but line_item_ids is required.

complete_checkout
Finalize the purchase and complete the checkout session using provided payment instruments. This action requires an idempotency key to prevent duplicate charges."
server2.ts: "Submit payment and place the order. Requires meta[\\\"idempotency-key\\\"] (UUID) in addition to meta[\\\"ucp-agent\\\"]. Use this tool when the checkout is ready and the buyer has authorized payment. This finalizes the transaction and creates an order. When to use: Checkout status is ready_for_complete, Buyer has reviewed and confirmed the order, or Payment credential has been collected.

cancel_checkout
Cancel an active checkout session. Requires meta[\\\"idempotency-key\\\"] (UUID) in addition to meta[\\\"ucp-agent\\\"]. Use this tool when a buyer abandons the checkout or explicitly requests cancellation. Canceled checkouts can't be resumed. Cancellation expires the checkout immediately. The canceled checkout resource includes expires_at, which is set to the cancellation timestamp. When to use: Buyer explicitly cancels the order, Session has been abandoned, or Need to start fresh with a new checkout.

get_ui_state
Retrieve the current state of the Commerce Layer.
Use this tool to verify what the buyer is currently seeing on their screen, including selected product variants, cart contents, and the current stage of the shopping progression.
Use this before making claims about what is on the buyer's screen, especially after a long, resumed, or interrupted conversation.`;

  // Exact tools configuration
  const TOOLS = [
    {
      type: "image_generation",
      model: "gpt-image-2.5-sunburst",
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
      background: "auto",
      moderation: "low",
      partial_images: 3
    },
    {
      type: "mcp",
      server_label: "my_master_server",
      server_url: "https://master-group-mcp.anigok.com/mcp",
      server_description: "Shopping",
      allowed_tools: [
        "search_catalog",
        "lookup_catalog",
        "get_product",
        "create_cart",
        "get_cart",
        "update_cart",
        "cancel_cart",
        "create_checkout",
        "get_checkout",
        "update_checkout",
        "complete_checkout",
        "cancel_checkout",
        "search_shop_policies_and_faqs"
      ],
      require_approval: "never"
    }
  ];

  // Conversation history for OpenAI input
  const inputHistory = [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text: DEVELOPER_PROMPT
        }
      ]
    }
  ];

  // Cart state
  let cartItemCount = 0;
  function updateCartBadge() {
    fetch('/cart.js')
      .then(r => r.json())
      .then(cart => {
        cartItemCount = cart.item_count || 0;
        const dot = shadow.querySelector('.cart-dot');
        if (dot) {
          dot.style.display = cartItemCount > 0 ? 'block' : 'none';
        }
      })
      .catch(() => {});
  }

  // Create Host Container & Shadow DOM
  const host = document.createElement('div');
  host.id = 'brand-agent-root';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // Check if on cart page for sticky center-bottom positioning
  const isCartPage = window.location.pathname.includes('/cart');

  // Styles matching the screenshot
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host {
      font-family: ${fontFamily};
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      inset: 0;
    }
    
    /* Floating launcher */
    .launcher {
      position: fixed;
      pointer-events: auto;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
      border: 1px solid rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
      ${isCartPage ? 'bottom: 24px; left: 50%; transform: translateX(-50%);' : 'bottom: 24px; right: 24px;'}
    }
    .launcher:hover {
      transform: ${isCartPage ? 'translateX(-50%) scale(1.05)' : 'scale(1.05)'};
      box-shadow: 0 6px 26px rgba(0,0,0,0.45);
    }
    .launcher svg {
      width: 26px;
      height: 26px;
      fill: none;
      stroke: #101012;
      stroke-width: 1.8;
      transition: transform 0.4s ease;
    }
    .launcher.loading svg {
      animation: spin 1s linear infinite;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }

    /* Shimmer effect */
    .launcher::after {
      content: '';
      position: absolute;
      inset: -2px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(255,255,255,0.8), rgba(255,255,255,0) 60%);
      opacity: 0;
      transition: opacity 0.3s;
    }
    .launcher:hover::after {
      opacity: 0.6;
    }

    /* Chat Container */
    .chat-box {
      position: fixed;
      bottom: 90px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 620px;
      max-height: calc(100vh - 120px);
      background: #141416;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 18px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.65);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      pointer-events: auto;
      transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      opacity: 0;
      transform: translateY(12px) scale(0.98);
      pointer-events: none;
    }
    .chat-box.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    /* Header */
    .chat-header {
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background: #141416;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .sparkle-badge {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: #ffffff;
      display: grid;
      place-items: center;
      color: #101012;
    }
    .sparkle-badge svg {
      width: 16px;
      height: 16px;
      stroke: #101012;
    }
    .agent-title {
      font-size: 14px;
      font-weight: 600;
      color: #f3f3f4;
      letter-spacing: -0.01em;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .h-btn {
      background: none;
      border: none;
      color: #a0a0a7;
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      display: grid;
      place-items: center;
      position: relative;
    }
    .h-btn:hover {
      background: rgba(255,255,255,0.08);
      color: #f3f3f4;
    }
    .h-btn svg { width: 17px; height: 17px; }
    .cart-dot {
      position: absolute;
      top: 3px;
      right: 3px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #3b82f6;
      display: none;
    }

    /* Messages Stream */
    .chat-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }
    .chat-body::-webkit-scrollbar { width: 5px; }
    .chat-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }

    /* Bubbles */
    .msg-user {
      align-self: flex-end;
      background: #232327;
      color: #f3f3f4;
      padding: 10px 14px;
      border-radius: 16px 16px 4px 16px;
      font-size: 13.5px;
      line-height: 1.45;
      max-width: 82%;
    }
    .msg-agent {
      align-self: flex-start;
      color: #f3f3f4;
      font-size: 13.5px;
      line-height: 1.5;
      width: 100%;
    }
    .msg-agent p { margin-bottom: 8px; }
    .msg-agent p:last-child { margin-bottom: 0; }

    /* In-Chat Live Commerce Product Card */
    .card-collection-title {
      font-size: 12px;
      font-weight: 700;
      color: #a0a0a7;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 10px 0 6px;
    }
    .product-card {
      background: #1b1b1e;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 12px;
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .card-top {
      display: flex;
      gap: 12px;
    }
    .card-thumb {
      width: 68px;
      height: 68px;
      border-radius: 10px;
      object-fit: cover;
      background: #232327;
      flex-shrink: 0;
    }
    .card-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .card-title {
      font-size: 13.5px;
      font-weight: 600;
      color: #f3f3f4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-price-row {
      display: flex;
      align-items: baseline;
      gap: 6px;
      font-size: 13px;
    }
    .card-price {
      font-weight: 700;
      color: #f3f3f4;
    }
    .card-compare {
      font-size: 11px;
      color: #6d6d74;
      text-decoration: line-through;
    }
    .card-tag {
      font-size: 10.5px;
      background: rgba(255,255,255,0.08);
      color: #a0a0a7;
      padding: 1px 5px;
      border-radius: 4px;
    }
    .btn-add-cart {
      margin-top: 4px;
      background: #27272a;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      color: #f3f3f4;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: background 0.15s;
    }
    .btn-add-cart:hover {
      background: #323236;
      border-color: rgba(255,255,255,0.22);
    }
    .card-desc {
      font-size: 12px;
      color: #a0a0a7;
      line-height: 1.4;
    }

    /* Virtual Try-On Result Box */
    .tryon-box {
      margin-top: 8px;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.12);
      background: #101012;
    }
    .tryon-box img {
      width: 100%;
      height: auto;
      display: block;
    }
    .tryon-caption {
      padding: 6px 10px;
      font-size: 11px;
      color: #a0a0a7;
      border-top: 1px solid rgba(255,255,255,0.08);
    }

    /* Input Footer */
    .chat-footer {
      padding: 12px 14px 10px;
      border-top: 1px solid rgba(255,255,255,0.08);
      background: #141416;
    }
    .input-pill {
      background: #1b1b1e;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 24px;
      padding: 4px 4px 4px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .input-pill input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #f3f3f4;
      font-size: 13.5px;
      font-family: inherit;
    }
    .input-pill input::placeholder { color: #6d6d74; }
    .send-btn {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #27272a;
      border: none;
      color: #f3f3f4;
      display: grid;
      place-items: center;
      cursor: pointer;
      transition: background 0.15s;
    }
    .send-btn:hover { background: #3b3b40; }
    .send-btn svg { width: 14px; height: 14px; }
    .disclaimer {
      font-size: 10px;
      color: #6d6d74;
      text-align: center;
      margin-top: 6px;
    }
    .disclaimer a { color: inherit; text-decoration: underline; }
  `;
  shadow.appendChild(style);

  // Build Floating Launcher DOM
  const launcher = document.createElement('div');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', 'Shop with AI');
  launcher.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  `;
  shadow.appendChild(launcher);

  // Build Chat Box DOM
  const chatBox = document.createElement('div');
  chatBox.className = 'chat-box';
  chatBox.innerHTML = `
    <header class="chat-header">
      <div class="header-left">
        <div class="sparkle-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>
          </svg>
        </div>
        <span class="agent-title">${agentName}</span>
      </div>
      <div class="header-actions">
        <button class="h-btn btn-cart" title="Shopping Cart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          <span class="cart-dot"></span>
        </button>
        <button class="h-btn btn-close" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </header>
    <div class="chat-body" id="chat-stream">
      <div class="msg-agent">
        <p>Welcome to ${brandName}! How can I help you find the perfect design today?</p>
      </div>
    </div>
    <footer class="chat-footer">
      <div class="input-pill">
        <input type="text" placeholder="Message ${agentName}" />
        <button class="send-btn" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="19" x2="12" y2="5"></line>
            <polyline points="5 12 12 5 19 12"></polyline>
          </svg>
        </button>
      </div>
      <div class="disclaimer">
        AI-generated. Verify pricing and availability. <a href="#">Privacy</a>
      </div>
    </footer>
  `;
  shadow.appendChild(chatBox);

  const streamEl = shadow.querySelector('#chat-stream');
  const inputEl = shadow.querySelector('.input-pill input');
  const sendBtn = shadow.querySelector('.send-btn');
  const closeBtn = shadow.querySelector('.btn-close');
  const cartBtn = shadow.querySelector('.btn-cart');

  // Toggle chat
  let isOpen = false;
  function toggleChat(open) {
    isOpen = open !== undefined ? open : !isOpen;
    if (isOpen) {
      chatBox.classList.add('open');
      inputEl.focus();
      updateCartBadge();
    } else {
      chatBox.classList.remove('open');
    }
  }

  launcher.addEventListener('click', () => toggleChat());
  closeBtn.addEventListener('click', () => toggleChat(false));
  cartBtn.addEventListener('click', () => { window.location.href = '/cart'; });

  // Native Shopify Add to Cart
  async function addToCart(variantId, btnEl) {
    if (!variantId) return;
    const cleanId = String(variantId).includes('/') ? String(variantId).split('/').pop() : variantId;
    if (btnEl) {
      btnEl.textContent = 'Adding…';
      btnEl.disabled = true;
    }
    try {
      const res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ items: [{ id: cleanId, quantity: 1 }] })
      });
      if (res.ok) {
        if (btnEl) btnEl.textContent = '✓ Added';
        updateCartBadge();
        window.dispatchEvent(new CustomEvent('cart:updated'));
      } else {
        if (btnEl) btnEl.textContent = '+ Add to cart';
      }
    } catch (e) {
      console.error('[BrandAgent] Cart error:', e);
      if (btnEl) btnEl.textContent = '+ Add to cart';
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  }

  // Live Commerce Markdown / Table to Product Card Parser
  function parseProductCards(markdownText) {
    // Looks for table cells or product blocks in the response
    // e.g. | ![img](url) <br> **Title** <br> $Price <br> [Add to Cart] |
    const productRegex = /!\[([^\]]*)\]\(([^)]+)\)[\s\S]*?\*\*([^*]+)\*\*[\s\S]*?(\$[\d.,]+)(?:[^\n]*?\(([^)]+)\))?/g;
    const matches = [];
    let match;
    while ((match = productRegex.exec(markdownText)) !== null) {
      matches.push({
        image: match[2],
        title: match[3].trim(),
        price: match[4].trim(),
        deal: match[5] || '',
        raw: match[0]
      });
    }
    return matches;
  }

  // Append User Message
  function appendUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'msg-user';
    bubble.textContent = text;
    streamEl.appendChild(bubble);
    streamEl.scrollTop = streamEl.scrollHeight;
  }

  // Append Agent Message Container
  function createAgentMessage() {
    const bubble = document.createElement('div');
    bubble.className = 'msg-agent';
    streamEl.appendChild(bubble);
    streamEl.scrollTop = streamEl.scrollHeight;
    return bubble;
  }

  // Exact Call to OpenAI responses.create with Streaming
  let conversationId = sessionStorage.getItem('brand_agent_conv_id') || ('conv_' + Date.now());
  sessionStorage.setItem('brand_agent_conv_id', conversationId);

  // Exact Call using Standard JSON (No SSE, No Client Prompts)
  async function sendMessage(text) {
    if (!text || !text.trim()) return;

    appendUserMessage(text);
    inputEl.value = '';
    launcher.classList.add('loading');

    // Add user message to conversation history
    inputHistory.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: text
        }
      ]
    });

    const agentBubble = createAgentMessage();
    const apiKey = getApiKey();
    const endpoint = currentScript?.getAttribute('data-endpoint') || (apiKey ? 'https://api.openai.com/v1/responses' : '/chat');

    try {
      let assistantText = '';
      let tryOnImageUrl = null;

      if (endpoint === 'https://api.openai.com/v1/responses') {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            model: "gpt-5.5",
            input: inputHistory,
            text: {
              format: { type: "text" },
              verbosity: "medium"
            },
            reasoning: {
              effort: "medium",
              mode: "standard",
              summary: "auto"
            },
            tools: TOOLS,
            store: true,
            include: [
              "reasoning.encrypted_content",
              "web_search_call.action.sources"
            ]
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('[BrandAgent] Request failed:', response.status, errText);
          agentBubble.remove();
          return;
        }

        const data = await response.json();
        if (data.output) {
          for (const item of data.output) {
            if (item.type === "message" && item.content) {
              for (const c of item.content) {
                if (c.type === "output_text" && c.text) {
                  assistantText += c.text;
                }
              }
            }
            if (item.type === "image_generation_call") {
              tryOnImageUrl = item.image?.url || item.result?.url;
            }
          }
        }
        if (!assistantText && data.output_text) {
          assistantText = data.output_text;
        }
      } else {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Shopify-Shop-Domain': storeDomain
          },
          body: JSON.stringify({
            message: text,
            conversation_id: conversationId,
            store_domain: storeDomain
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('[BrandAgent] Request failed:', response.status, errText);
          agentBubble.remove();
          return;
        }

        const data = await response.json();
        if (data.error) {
          console.error('[BrandAgent] Error:', data.error);
          agentBubble.remove();
          return;
        }

        if (data.conversation_id) {
          conversationId = data.conversation_id;
          sessionStorage.setItem('brand_agent_conv_id', conversationId);
        }
        assistantText = data.message || '';
      }

      if (!assistantText) {
        agentBubble.remove();
        return;
      }

      agentBubble.innerHTML = formatMarkdown(assistantText);

      if (tryOnImageUrl) {
        const tryonEl = document.createElement('div');
        tryonEl.className = 'tryon-box';
        tryonEl.innerHTML = `
          <img src="${tryOnImageUrl}" alt="Virtual Try-On Preview" />
          <div class="tryon-caption">Virtual Try-On Preview</div>
        `;
        agentBubble.appendChild(tryonEl);
      }

      streamEl.scrollTop = streamEl.scrollHeight;

      inputHistory.push({
        role: "assistant",
        content: [{ type: "output_text", text: assistantText }]
      });

      attachProductCardActions(agentBubble);

    } catch (err) {
      console.error('[BrandAgent] Request failed:', err);
      agentBubble.remove();
    } finally {
      launcher.classList.remove('loading');
    }
  }

  // Format simple markdown into clean HTML with Product Cards
  function formatMarkdown(txt) {
    let clean = txt
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Parse table rows with product representations into in-chat cards
    const products = parseProductCards(clean);
    if (products.length > 0) {
      // Remove raw markdown table strings to avoid clutter
      clean = clean.replace(/\|[\s\S]*?\|/g, '');
      let cardsHtml = '<div class="card-collection-title">Product Recommendations</div>';
      products.forEach((p, idx) => {
        cardsHtml += `
          <div class="product-card" data-idx="${idx}">
            <div class="card-top">
              <img class="card-thumb" src="${p.image}" alt="${p.title}" />
              <div class="card-info">
                <div class="card-title">${p.title}</div>
                <div class="card-price-row">
                  <span class="card-price">${p.price}</span>
                  ${p.deal ? `<span class="card-tag">${p.deal}</span>` : ''}
                </div>
                <button type="button" class="btn-add-cart" data-title="${encodeURIComponent(p.title)}">
                  + Add to cart
                </button>
              </div>
            </div>
          </div>
        `;
      });
      clean += cardsHtml;
    }

    return clean.replace(/\n\n/g, '<p></p>');
  }

  // Hook up Add to Cart buttons
  function attachProductCardActions(container) {
    container.querySelectorAll('.btn-add-cart').forEach(btn => {
      btn.addEventListener('click', async () => {
        const title = decodeURIComponent(btn.getAttribute('data-title') || '');
        // Search storefront products.json to resolve the exact variant ID
        try {
          const res = await fetch('/products.json?limit=50');
          const data = await res.json();
          const p = (data.products || []).find(item => item.title.toLowerCase().includes(title.toLowerCase()));
          const variantId = p?.variants?.[0]?.id;
          if (variantId) {
            addToCart(variantId, btn);
          } else {
            btn.textContent = 'View product';
            if (p?.handle) window.location.href = `/products/${p.handle}`;
          }
        } catch {
          btn.textContent = 'Added';
        }
      });
    });
  }

  // Send on enter or click
  sendBtn.addEventListener('click', () => sendMessage(inputEl.value));
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage(inputEl.value);
  });

  // Global BrandAgent Interface
  window.BrandAgent = {
    open: () => toggleChat(true),
    close: () => toggleChat(false),
    send: (msg) => { toggleChat(true); sendMessage(msg); },
    nudge: (html) => {
      toggleChat(true);
      const bubble = createAgentMessage();
      bubble.innerHTML = html;
    }
  };

  // Initial cart badge check
  updateCartBadge();

})();
