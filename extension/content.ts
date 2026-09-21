/**
 * extension/content.ts - Chrome Extension Content Script
 *
 * Injects the LiveCommerce Shopping Copilot inside an isolated Shadow DOM
 * so host website styles (Amazon, Nike, Shopify, etc.) never interfere.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import CommerceExtension from './CommerceExtension';
import stylesText from './styles.css?inline';

function initLiveCommerceExtension() {
  if (document.getElementById('livecommerce-extension-host')) {
    return; // Avoid duplicate injection
  }

  const container = document.body || document.documentElement;
  if (!container) {
    return;
  }

  // 1. Create host element
  const host = document.createElement('div');
  host.id = 'livecommerce-extension-host';
  host.style.position = 'fixed';
  host.style.bottom = '0';
  host.style.left = '0';
  host.style.width = '100%';
  host.style.height = '0';
  host.style.overflow = 'visible';
  host.style.zIndex = '2147483647';
  container.appendChild(host);

  // 2. Attach isolated Shadow DOM
  const shadowRoot = host.attachShadow({ mode: 'open' });

  // 3. Inject Tailwind CSS Stylesheet directly into Shadow DOM
  const styleEl = document.createElement('style');
  styleEl.textContent = stylesText;
  shadowRoot.appendChild(styleEl);

  // Base font and smoothing reset
  const baseStyle = document.createElement('style');
  baseStyle.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
  `;
  shadowRoot.appendChild(baseStyle);

  // 4. Create React mount target inside Shadow DOM
  const mountPoint = document.createElement('div');
  mountPoint.id = 'livecommerce-app-mount';
  shadowRoot.appendChild(mountPoint);

  // 5. Mount React App
  const root = ReactDOM.createRoot(mountPoint);
  root.render(React.createElement(CommerceExtension));

  console.log('[LiveCommerce] HUD mounted in isolated Shadow DOM');
}

export { initLiveCommerceExtension };

// Run when DOM is ready or immediately if already loaded
console.log('[LiveCommerce] Content script active on:', window.location.href);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLiveCommerceExtension);
} else {
  initLiveCommerceExtension();
}

