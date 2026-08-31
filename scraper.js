const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

(async () => {
    try {
        console.log("Launching headless browser...");
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--window-size=1920,1080',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ] 
        });
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Block ads/media to speed up load, but ALLOW scripts/xhr/fetch
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log("Navigating to site...");
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        console.log("Extracting raw HTML to bypass DOM rendering issues...");
        
        // Grab the raw HTML source code of the page
        const rawHTML = await page.content();
        
        // The site likely uses Next.js, which embeds the initial data in a <script id="__NEXT_DATA__"> tag.
        // If we can find that, we don't even need to scrape the page.
        const nextDataMatch = rawHTML.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
        
        let finalData = {};

        if (nextDataMatch) {
            console.log("Found __NEXT_DATA__ JSON payload. Extracting data directly from source...");
            try {
                const nextData = JSON.parse(nextDataMatch[1]);
                // This is a guess at the Next.js structure. We stringify it to regex search the whole payload.
                const stringifiedData = JSON.stringify(nextData);
                
                // Fallback to regex scraping the raw HTML if we can't easily parse the JSON structure
                finalData = extractFromText(rawHTML);

            } catch (e) {
                console.log("Failed to parse NEXT_DATA, falling back to raw HTML parsing.");
                finalData = extractFromText(rawHTML);
            }
        } else {
            console.log("No NEXT_DATA found, parsing raw HTML...");
            finalData = extractFromText(rawHTML);
        }

        await browser.close();

        const itemCount = Object.keys(finalData).length;
        console.log(`Successfully scraped ${itemCount} live items!`);

        if (itemCount === 0) {
            console.error("ERROR: Extracted 0 items. Throwing error to fail Action and protect values.json.");
            process.exit(1);
        } else {
            fs.writeFileSync('values.json', JSON.stringify(finalData, null, 2));
            console.log("values.json updated with LIVE data.");
        }

    } catch (error) {
        console.error("Scraper execution failed:", error);
        process.exit(1);
    }
})();

// Helper function that regex searches plain text (like raw HTML) for item patterns
function extractFromText(text) {
    const items = {};
    
    // Clean up HTML tags to make regex easier
    const cleanText = text.replace(/<[^>]*>?/gm, ' ');
    
    // Look for patterns that match: Name Value [number] Demand [fraction] Trend [word]
    // Because we are searching raw text, we need to be slightly flexible
    
    // We will look for demand fractions (e.g. 10/10) and then search around them
    const regex = /(.{5,30})\s*(?:Value|value)[:\s]*([0-9\.]+[KMBT]?|N\/A)\s*(?:Demand|demand)[:\s]*([0-9]+\/10|SOON|N\/A)\s*(?:Trend|trend)[:\s]*(Stable|Overpaid|Underpaid|SOON)/gi;
    
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
        let rawName = match[1].trim();
        const value = match[2].toUpperCase();
        let demand = match[3].toUpperCase();
        let trend = match[4];
        
        // Clean up Name
        const skip = ["mythical", "legendary", "rare", "uncommon", "common", "gamepass", "new", "regular", "permanent"];
        const nameWords = rawName.split(/\s+/).filter(w => !skip.includes(w.toLowerCase()));
        const name = nameWords.join(" ");

        // Clean up Demand and Trend
        if (demand.includes("/")) demand = demand.split(" ")[0] + "/10";
        if (trend.toLowerCase() === 'stable') trend = 'Stable';
        if (trend.toLowerCase() === 'overpaid') trend = 'Overpaid';
        if (trend.toLowerCase() === 'underpaid') trend = 'Underpaid';
        if (trend.toLowerCase() === 'soon') trend = 'SOON';

        if (name && value && value !== "0" && !value.toLowerCase().includes("list")) {
            // Check if it's a permanent variant by looking for the word "Permanent" in the raw match area
            let finalName = name;
            
            // To handle permanent, we'd need to know if it's the perm version. 
            // In raw HTML, they might be listed twice. We'll store both.
            if (!items[finalName]) {
                 items[finalName] = { Value: value, Demand: demand, Trend: trend };
            } else if (!items["Permanent " + finalName]) {
                 // If the base item exists, assume this second match is the permanent version
                 items["Permanent " + finalName] = { Value: value, Demand: demand, Trend: trend };
            }
        }
    }
    
    return items;
}
