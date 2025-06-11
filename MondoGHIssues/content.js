// Check if the script has already run to prevent multiple executions.
if (!window.mondoAnalyzerInitialized) {
    // Set the guard flag immediately.
    window.mondoAnalyzerInitialized = true;
    console.log('Mondo Analyzer: Initializing script (v9 - Complete & Final).');

    /**
     * This function sends the issue's title and body to the AI for analysis.
     * The core "testing logic" is defined inside the 'prompt' constant here.
     */
    async function analyzeIssueWithLLM(title, body, apiKey) {
        const apiURL = 'https://api.openai.com/v1/chat/completions';

        // This is the full set of instructions and tests for the AI.
        const prompt = `
            You are an expert ontology curator for the Mondo Disease Ontology.
            Your task is to analyze a GitHub issue requesting a new term.
            The issue must follow a specific template.

            Analyze the following issue content and determine if all required fields are filled out correctly.
            The required fields are:
            1.  "New term label": Should be present and unambiguous.
            2.  "Your nano-attribution (ORCID)": Should be present.
            3.  "Parent term": Should be a valid MONDO ID (e.g., MONDO:0000001).
            4.  "Definition": Should be a clear, scientific definition.
            5.  "Synonyms": Should list at least one synonym or state "None".
            6.  "Related DBXrefs": Should provide related database cross-references or state "None".

            Based on your analysis, provide a summary and a recommended action.

            ISSUE TITLE: "${title}"
            ISSUE BODY:
            ---
            ${body}
            ---

            Return your analysis ONLY as a JSON object with the following structure:
            {
              "summary": "A one-sentence summary of the request and its readiness.",
              "checks": [
                { "field": "Term Label", "status": "OK|MISSING|INCOMPLETE", "comment": "Your reasoning." },
                { "field": "Attribution (ORCID)", "status": "OK|MISSING|INCOMPLETE", "comment": "Your reasoning." },
                { "field": "Parent Term", "status": "OK|MISSING|INVALID_FORMAT", "comment": "Your reasoning. If invalid, state why." },
                { "field": "Definition", "status": "OK|MISSING|INCOMPLETE", "comment": "Your reasoning." },
                { "field": "Synonyms", "status": "OK|MISSING", "comment": "Your reasoning." }
              ],
              "recommendedAction": "READY_FOR_CURATOR|NEEDS_MORE_INFO|OUT_OF_SCOPE",
              "actionComment": "A brief explanation for the recommended action."
            }
        `;
        try {
            const response = await fetch(apiURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: 'gpt-4-turbo-preview',
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: "json_object" }
                })
            });
            if (!response.ok) throw new Error(`API request failed: ${response.statusText}`);
            const data = await response.json();
            return JSON.parse(data.choices[0].message.content);
        } catch (error) {
            console.error('Mondo Analyzer: Error analyzing issue:', error);
            return { error: `Failed to get analysis from API. ${error.message}` };
        }
    }

    /**
     * This function takes the JSON response from the AI and renders it as HTML on the page.
     */
    function displayAnalysisUI(analysis, targetElement) {
        if (!targetElement) return;
        if (analysis.error) {
            targetElement.innerHTML = `<h3>Mondo Issue Analysis</h3><p style="color: #f85149;">${analysis.error}</p>`;
            return;
        }
        const getIcon = (status) => {
            switch(status) {
                case 'OK': return '<span class="status-icon success">✔</span>';
                case 'MISSING': case 'INCOMPLETE': case 'INVALID_FORMAT': return '<span class="status-icon warning">⚠️</span>';
                default: return '<span class="status-icon error">✖</span>';
            }
        };
        let checksHTML = analysis.checks.map(item => `
            <div class="analysis-item">
                ${getIcon(item.status)}
                <div><strong>${item.field}:</strong> ${item.comment}</div>
            </div>`).join('');
        targetElement.innerHTML = `
            <h3>Mondo Issue Analysis</h3>
            <p><strong>Summary:</strong> ${analysis.summary}</p>
            <p><strong>Recommended Action:</strong> <strong>${analysis.recommendedAction.replace(/_/g, ' ')}</strong> - ${analysis.actionComment}</p>
            <hr style="border-color: #30363d; margin: 12px 0;">
            <h4>Template Checklist</h4>
            ${checksHTML}`;
    }

    /**
     * This function sets up the button on the page and contains all the final, correct selectors.
     */
    function initializeAnalyzerUI() {
        // The correct selector for finding the labels, based on your screenshot.
        const labelElements = document.querySelectorAll('[data-testid="issue-labels"] a');
        const issueLabels = Array.from(labelElements).map(labelElement => labelElement.innerText.trim());
        
        console.log('Mondo Analyzer: Found labels:', issueLabels);

        if (!issueLabels.includes('new term request')) {
            console.log('Mondo Analyzer: Label "new term request" not found. Skipping UI injection.'); 
            return;
        }

        // The correct anchor element to inject our UI after.
        const issueHeader = document.querySelector('[data-testid="issue-header"]'); 
        
        if (issueHeader && !document.getElementById('mondo-analyzer-container')) {
            const container = document.createElement('div');
            container.id = 'mondo-analyzer-container';
            const analyzeButton = document.createElement('button');
            analyzeButton.id = 'mondo-analyze-btn';
            analyzeButton.className = 'btn';
            // analyzeButton.innerHTML = '🤖  Analyze Issue';
            analyzeButton.innerHTML = 'Analyze Issue';
            const resultsDiv = document.createElement('div');
            resultsDiv.id = 'mondo-analyzer-results';
            container.appendChild(analyzeButton);
            container.appendChild(resultsDiv);
            issueHeader.parentNode.insertBefore(container, issueHeader.nextSibling);
            console.log('Mondo Analyzer: UI injected successfully.');

            analyzeButton.addEventListener('click', async () => {
                document.getElementById('mondo-analyzer-container').classList.add('analysis-displayed');
                analyzeButton.disabled = true;
                resultsDiv.innerHTML = '<p>Analyzing, please wait...</p>';
                const data = await chrome.storage.sync.get(['openai_api_key']);
                if (!data.openai_api_key) {
                    resultsDiv.innerHTML = `<p style="color: #d29922;">OpenAI API Key not set. Please set it in the extension popup.</p>`;
                    analyzeButton.disabled = false; return;
                }
                const issueTitle = document.querySelector('[data-testid="issue-title"]').innerText;
                
                // The final, correct selector for the issue body text, based on your screenshot.
                const issueBodyElement = document.querySelector('.markdown-body');
                
                if (!issueBodyElement) {
                    console.error("Mondo Analyzer: Could not find the issue body element with class '.markdown-body'");
                    resultsDiv.innerHTML = `<p style="color: #f85149;">Error: Could not find the issue's main text. The page structure may have changed.</p>`;
                    analyzeButton.disabled = false;
                    return;
                }
                const issueBody = issueBodyElement.innerText;
                
                const analysis = await analyzeIssueWithLLM(issueTitle, issueBody, data.openai_api_key);
                displayAnalysisUI(analysis, resultsDiv);
                analyzeButton.disabled = false;
            });
        }
    }

    /**
     * This observer waits for the page to be ready before trying to inject the UI.
     */
    const observer = new MutationObserver((mutations, obs) => {
        // Waits for our reliable anchor element to appear.
        if (document.querySelector('[data-testid="issue-header"]')) {
            console.log('Mondo Analyzer: Observer found injection point.');
            initializeAnalyzerUI();
            obs.disconnect();
            console.log('Mondo Analyzer: Observer disconnected.');
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

} // End of the main "if" block