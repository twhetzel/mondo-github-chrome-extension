// Check if the script has already run to prevent multiple executions.
if (!window.mondoAnalyzerInitialized) {
    // Set the guard flag immediately.
    window.mondoAnalyzerInitialized = true;
    console.log('Mondo Analyzer: Initializing script (v15 - Conditional Workflow).');

    /**
     * This function takes the JSON response from the AI and renders it as HTML on the page.
     * It includes the linkify helper to make URLs clickable.
     */
    function displayAnalysisUI(analysis, targetElement) {
        if (!targetElement || !analysis) { console.error("Invalid data passed to displayAnalysisUI"); return; }
        if (analysis.error) {
            targetElement.innerHTML = `<h3>Mondo Issue Analysis</h3><p style="color: #f85149;">${analysis.error}</p>`;
            return;
        }
        
        const getIcon = (status) => {
            const upperStatus = status ? status.toUpperCase() : 'ERROR';
            switch(upperStatus) {
                case 'OK': return '<span class="status-icon success">✔</span>';
                case 'NOT_APPLICABLE': return '<span class="status-icon na">-</span>';
                case 'MISSING': case 'INCOMPLETE': case 'INVALID_FORMAT': return '<span class="status-icon warning">⚠️</span>';
                default: console.warn(`Unknown status received from AI: "${status}"`); return '<span class="status-icon error">✖</span>';
            }
        };

        function linkify(text) {
            if (!text) return '';
            const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
            return text.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
        }

        if (!analysis.checks || !Array.isArray(analysis.checks)) {
            targetElement.innerHTML = `<p style="color: #f85149;">Error: Analysis response from AI was malformed.</p>`;
            return;
        }
        
        let checksHTML = analysis.checks.map(item => {
            const linkedComment = linkify(item.comment || 'No comment provided.');
            return `
            <div class="analysis-item">
                ${getIcon(item.status)}
                <div><strong>${item.field}:</strong> ${linkedComment}</div>
            </div>`;
        }).join('');
        
        targetElement.innerHTML = `
            <h3>Mondo Issue Analysis</h3>
            <p><strong>Summary:</strong> ${analysis.summary || 'No summary provided.'}</p>
            <p><strong>Recommended Action:</strong> <strong>${(analysis.recommendedAction || 'NONE').replace(/_/g, ' ')}</strong> - ${analysis.actionComment || ''}</p>
            <hr style="border-color: #d0d7de; margin: 12px 0;">
            <h4>Template Checklist</h4>
            ${checksHTML}`;
    }

    /**
     * This function sets up the button and contains the master workflow logic.
     */
    function initializeAnalyzerUI() {
        if (document.getElementById('mondo-analyzer-container')) {
            return;
        }
        const labelElements = document.querySelectorAll('[data-testid="issue-labels"] a');
        const issueLabels = Array.from(labelElements).map(l => l.innerText.trim());
        if (!issueLabels.includes('new term request')) { return; }

        const issueHeader = document.querySelector('[data-testid="issue-header"]');
        
        if (issueHeader) {
            const container = document.createElement('div');
            container.id = 'mondo-analyzer-container';
            const analyzeButton = document.createElement('button');
            analyzeButton.id = 'mondo-analyze-btn';
            analyzeButton.className = 'btn';
            analyzeButton.innerHTML = 'Analyze Issue';
            const resultsDiv = document.createElement('div');
            resultsDiv.id = 'mondo-analyzer-results';
            container.appendChild(analyzeButton);
            container.appendChild(resultsDiv);
            issueHeader.parentNode.insertBefore(container, issueHeader.nextSibling);

            analyzeButton.addEventListener('click', async () => {
                document.getElementById('mondo-analyzer-container').classList.add('analysis-displayed');
                analyzeButton.disabled = true;
                const apiKey = (await chrome.storage.sync.get(['openai_api_key'])).openai_api_key;
                if (!apiKey) {
                    resultsDiv.innerHTML = `<p style="color: #d29922;">OpenAI API Key not set.</p>`;
                    analyzeButton.disabled = false; return;
                }
                const issueTitle = document.querySelector('[data-testid="issue-title"]').innerText;
                const issueBody = document.querySelector('.markdown-body').innerText;

                try {
                    // --- Master Workflow Switch ---
                    if (issueTitle.trim().startsWith('[NTR/gene]')) {
                        // --- GENE-SPECIFIC WORKFLOW ---
                        resultsDiv.innerHTML = '<p>Step 1/3: Extracting gene & species info from title...</p>';
                        const geneInfo = await extractGeneInfoFromLLM(issueTitle, apiKey);

                        if (!geneInfo.geneSymbol) {
                            throw new Error("Title starts with [NTR/gene] but could not extract a gene symbol.");
                        }
                        
                        let geneDetails;
                        if (geneInfo.animal) {
                            // --- NCBI Path (Non-Human) ---
                            resultsDiv.innerHTML = `<p>Step 2/3: Searching NCBI for gene "${geneInfo.geneSymbol}" in ${geneInfo.animal}...</p>`;
                            const response = await chrome.runtime.sendMessage({ action: 'fetchNcbiGeneDetails', data: geneInfo });
                            if (response.status === 'error') throw new Error(response.message);
                            geneDetails = response.details;
                        } else {
                            // --- HGNC Path (Human) ---
                            resultsDiv.innerHTML = `<p>Step 2/3: Searching HGNC for human gene "${geneInfo.geneSymbol}"...</p>`;
                            const response = await chrome.runtime.sendMessage({ action: 'fetchHgncGeneDetails', data: geneInfo });
                            if (response.status === 'error') throw new Error(response.message);
                            geneDetails = response.details;
                        }

                        resultsDiv.innerHTML = `<p>Step 3/3: Compiling final analysis...</p>`;
                        const finalAnalysis = await getFinalAnalysisFromLLM(issueTitle, issueBody, geneDetails, apiKey);
                        displayAnalysisUI(finalAnalysis, resultsDiv);
                    } else {
                        // --- SIMPLE WORKFLOW ---
                        resultsDiv.innerHTML = '<p>Analyzing as a standard term...</p>';
                        const simpleAnalysis = await getSimpleAnalysisFromLLM(issueTitle, issueBody, apiKey);
                        displayAnalysisUI(simpleAnalysis, resultsDiv);
                    }
                } catch (error) {
                    console.error("Analysis pipeline failed:", error);
                    resultsDiv.innerHTML = `<p style="color: #d1242f;">Error during analysis: ${error.message}</p>`;
                } finally {
                    analyzeButton.disabled = false;
                }
            });
        }
    }

    /**
     * LLM Call #1: Extracts gene symbol and determines if human or non-human context.
     */
    async function extractGeneInfoFromLLM(title, apiKey) {
        const prompt = `Your job is to extract a gene symbol and potentially a non-human animal from a GitHub issue title. The title is: "${title}". 1. Look for a short, all-caps gene symbol (e.g., "KIT", "STX17"). 2. Look for a non-human animal. If found, provide its scientific name (e.g., "feline" -> "Felis catus", "canine" -> "Canis lupus familiaris"). If no non-human animal is mentioned, assume the context is human. Return a JSON object like {"animal": "...", "geneSymbol": "..."}. If the context is human, return {"animal": null, "geneSymbol": "..."}. If no gene symbol can be found, return {"geneSymbol": null}. Return ONLY the JSON object.`;
        const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'gpt-4-turbo-preview', messages: [{ role: 'user', content: prompt }], response_format: { type: "json_object" } }) });
        if (!response.ok) throw new Error(`LLM call (extractGeneInfo) failed: ${response.statusText}`);
        const data = await response.json();
        return JSON.parse(data.choices[0].message.content);
    }

    /**
     * LLM Call #2: Takes enriched data (from NCBI or HGNC) and creates the final report.
     */
    async function getFinalAnalysisFromLLM(title, body, geneDetails, apiKey) {
        let geneContext;
        if (geneDetails) {
            geneContext = `A search for the gene in the title was performed. The following verified information was found from ${geneDetails.source}:
            - Gene ID: ${geneDetails.geneId}
            - Full Gene Name: "${geneDetails.geneName}"
            - Link: ${geneDetails.geneLink}
            For the "Gene Identifier" check, the status MUST be "OK".`;
        } else {
            geneContext = `A search for the gene in the title was performed, but no matching ID was found from the relevant database (NCBI or HGNC). For the "Gene Identifier" check, the status MUST be "MISSING".`;
        }

        const prompt = `You are an expert ontology curator. Analyze the following GitHub issue using the information I provide.
            ${geneContext}
            The issue body is below:
            ---
            ${body}
            ---
            Return your analysis as a JSON object with the exact structure: {"summary": "...", "checks": [{"field": "...", "status": "...", "comment": "..."}], "recommendedAction": "...", "actionComment": "..."}.
            The "checks" array MUST contain these six fields in this order: "Term Label", "Attribution (ORCID)", "Parent Term", "Definition", "Synonyms", "Gene Identifier".
            For EACH item in the "checks" array, the "status" value MUST be one of these exact strings: "OK", "MISSING", "INCOMPLETE", "INVALID_FORMAT".
            For the "Gene Identifier" comment, you MUST include the source (NCBI/HGNC), the full gene name, and the link if they were found. If nothing was found, state that.`;
        const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'gpt-4-turbo-preview', messages: [{ role: 'user', content: prompt }], response_format: { type: "json_object" } }) });
        if (!response.ok) throw new Error(`LLM call (getFinalAnalysis) failed: ${response.statusText}`);
        const data = await response.json();
        return JSON.parse(data.choices[0].message.content);
    }
    
    /**
     * Fallback LLM Call: For simple issues that do not start with [NTR/gene].
     */
    async function getSimpleAnalysisFromLLM(title, body, apiKey) {
        const prompt = `You are an expert ontology curator. Analyze the following GitHub issue.
            The issue body is below:
            ---
            ${body}
            ---
            Return your analysis as a JSON object with the exact structure: {"summary": "...", "checks": [{"field": "...", "status": "...", "comment": "..."}], "recommendedAction": "...", "actionComment": "..."}.
            The "checks" array MUST contain these five fields in this order: "Term Label", "Attribution (ORCID)", "Parent Term", "Definition", "Synonyms".
            For each check, the "status" value MUST be one of these exact strings: "OK", "MISSING", "INCOMPLETE", "INVALID_FORMAT".`;
        const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: 'gpt-4-turbo-preview', messages: [{ role: 'user', content: prompt }], response_format: { type: "json_object" } }) });
        if (!response.ok) throw new Error(`LLM call (getSimpleAnalysis) failed: ${response.statusText}`);
        const data = await response.json();
        return JSON.parse(data.choices[0].message.content);
    }
    
    // This observer waits for the page to be ready before trying to inject the UI.
    const observer = new MutationObserver((mutations) => {
        initializeAnalyzerUI();
    });

    // This will fire on full page loads and on SPA navigations.
    observer.observe(document.body, { 
        childList: true, 
        subtree: true 
    });
}