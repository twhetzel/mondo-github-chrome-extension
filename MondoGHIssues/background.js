/**
 * Listens for messages from the content script.
 * This acts as a router, calling the correct search function based on the message action.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Route the request to the NCBI search function
    if (request.action === 'fetchNcbiGeneDetails') {
        console.log('Background received NCBI search task:', request.data);
        searchNcbiGene(request.data.animal, request.data.geneSymbol)
            .then(details => sendResponse({ status: 'success', details: details }))
            .catch(error => {
                console.error('NCBI Search Error:', error);
                sendResponse({ status: 'error', message: error.message });
            });
        return true; // Keep the message channel open for the async response
    }

    // Route the request to the HGNC search function
    if (request.action === 'fetchHgncGeneDetails') {
        console.log('Background received HGNC search task:', request.data);
        searchHgncGene(request.data.geneSymbol)
            .then(details => sendResponse({ status: 'success', details: details }))
            .catch(error => {
                console.error('HGNC Search Error:', error);
                sendResponse({ status: 'error', message: error.message });
            });
        return true; // Keep the message channel open for the async response
    }
});

/**
 * Searches the NCBI Gene database for a specific gene in a non-human organism.
 * @param {string} animal - The scientific name of the organism (e.g., "Felis catus").
 * @param {string} geneSymbol - The gene symbol to search for (e.g., "KIT").
 * @returns {Promise<object|null>} A promise that resolves to an object with the gene details or null if not found.
 */
async function searchNcbiGene(animal, geneSymbol) {
    // Step 1: Use esearch to find the gene ID from the symbol and organism.
    const searchTerm = `${geneSymbol}[Gene Name] AND ${animal}[Organism]`;
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene&term=${encodeURIComponent(searchTerm)}&retmode=json`;
    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) throw new Error(`NCBI esearch request failed: ${searchResponse.statusText}`);
    const searchData = await searchResponse.json();
    const idList = searchData.esearchresult?.idlist;

    if (!idList || idList.length === 0) {
        console.log(`No NCBI Gene ID found for ${geneSymbol} in ${animal}.`);
        return null;
    }
    const geneId = idList[0];

    // Step 2: Use esummary to get the rich details for that specific ID.
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=${geneId}&retmode=json`;
    const summaryResponse = await fetch(summaryUrl);
    if (!summaryResponse.ok) throw new Error(`NCBI esummary request failed: ${summaryResponse.statusText}`);
    const summaryData = await summaryResponse.json();
    const result = summaryData.result[geneId];
    if (!result) return null;

    const details = {
        source: 'NCBI',
        geneId: geneId,
        geneName: result.name,
        geneLink: `https://www.ncbi.nlm.nih.gov/gene/${geneId}`
    };
    console.log('Returning enriched NCBI details:', details);
    return details;
}

/**
 * Searches the HGNC database for a human gene.
 * @param {string} geneSymbol - The gene symbol to search for (e.g., "BRCA1").
 * @returns {Promise<object|null>} A promise that resolves to an object with the gene details or null if not found.
 */
async function searchHgncGene(geneSymbol) {
    const url = `https://rest.genenames.org/fetch/symbol/${geneSymbol}`;
    console.log('Searching HGNC with URL:', url);
    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' } // HGNC API requires this header
    });

    if (!response.ok) {
        // HGNC returns a 404 if the symbol is not found, which is expected behavior, not an error.
        if (response.status === 404) {
            console.log(`No HGNC entry found for symbol: ${geneSymbol}`);
            return null;
        }
        throw new Error(`HGNC API request failed: ${response.statusText}`);
    }
    const data = await response.json();
    const doc = data.response?.docs[0];
    if (!doc) return null;

    const details = {
        source: 'HGNC',
        geneId: doc.hgnc_id,
        geneName: doc.name,
        geneLink: `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${doc.hgnc_id}`
    };
    console.log('Returning enriched HGNC details:', details);
    return details;
}