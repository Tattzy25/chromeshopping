/**
 * extension/background.ts - Background Service Worker
 *
 * Responsibilities:
 *  - Native tab navigation (chrome.tabs.update)
 *  - Relaying messages between content scripts and tab APIs
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NAVIGATE_TAB' && message.url) {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.update(sender.tab.id, { url: message.url }, (updatedTab) => {
        sendResponse({ success: true, tab: updatedTab });
      });
      return true; // async response
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.update(tabs[0].id, { url: message.url }, (updatedTab) => {
            sendResponse({ success: true, tab: updatedTab });
          });
        }
      });
      return true;
    }
  }

  if (message.type === 'OPEN_NEW_TAB' && message.url) {
    chrome.tabs.create({ url: message.url }, (tab) => {
      sendResponse({ success: true, tab });
    });
    return true;
  }

  if (message.type === 'GET_TAB_CONTEXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({
          url: tabs[0].url,
          title: tabs[0].title,
          id: tabs[0].id
        });
      } else {
        sendResponse({ url: null, title: null, id: null });
      }
    });
    return true;
  }
});
