/**
 * extension/popup.ts - Popup controller
 */
const DEFAULT_MCP_URL = 'https://master-group-mcp.anigok.com/mcp';

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
  const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
  const statusDiv = document.getElementById('status') as HTMLDivElement;

  const toggleCopilotBtn = document.getElementById('toggleCopilotBtn') as HTMLButtonElement;
  const copilotStatusText = document.getElementById('copilotStatusText') as HTMLDivElement;

  let isEnabled = true;

  const updateToggleUI = (enabled: boolean) => {
    isEnabled = enabled;
    if (enabled) {
      copilotStatusText.textContent = 'Active on page';
      copilotStatusText.style.color = '#34d399';
      toggleCopilotBtn.textContent = 'Turn Off';
      toggleCopilotBtn.style.background = '#27272a';
      toggleCopilotBtn.style.color = '#fafafa';
    } else {
      copilotStatusText.textContent = 'Turned Off';
      copilotStatusText.style.color = '#a1a1aa';
      toggleCopilotBtn.textContent = 'Turn On';
      toggleCopilotBtn.style.background = '#ffffff';
      toggleCopilotBtn.style.color = '#000000';
    }
  };

  // Load existing key and copilot status
  chrome.storage.local.get(['OPENAI_API_KEY', 'COPILOT_ENABLED'], (res) => {
    if (res.OPENAI_API_KEY) {
      apiKeyInput.value = res.OPENAI_API_KEY;
    }
    updateToggleUI(res.COPILOT_ENABLED ?? true);
  });

  // Toggle Copilot
  toggleCopilotBtn.addEventListener('click', () => {
    const nextState = !isEnabled;
    chrome.storage.local.set({ COPILOT_ENABLED: nextState }, () => {
      updateToggleUI(nextState);
    });
  });

  // Save key and ensure default MCP URL is set internally
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();

    chrome.storage.local.set({
      OPENAI_API_KEY: key,
      MCP_SERVER_URL: DEFAULT_MCP_URL,
    }, () => {
      statusDiv.style.display = 'block';
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 2000);
    });
  });
});
