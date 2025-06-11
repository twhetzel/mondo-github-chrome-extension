document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const saveButton = document.getElementById('saveButton');
    const statusEl = document.getElementById('status');

    // Load any previously saved key when the popup opens
    chrome.storage.sync.get(['openai_api_key'], (result) => {
        if (result.openai_api_key) {
            apiKeyInput.value = result.openai_api_key;
        }
    });

    // Save the key to chrome's synchronized storage
    saveButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value;
        if (apiKey) {
            chrome.storage.sync.set({ 'openai_api_key': apiKey }, () => {
                statusEl.textContent = 'API Key saved successfully!';
                // Close the popup automatically after 2 seconds
                setTimeout(() => { window.close(); }, 2000);
            });
        } else {
          statusEl.style.color = 'red';
          statusEl.textContent = 'Please enter a key.';
        }
    });
});