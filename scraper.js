const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

(async () => {
    try {
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'] 
        });
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log("Navigating to site...");
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'networkidle2', timeout: 30000 });
        
        console.log("Scrolling page to load all items...");
        await page.evaluate(async () => {
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            while (true) {
                window.scrollBy(0, 800);
                await delay(800);
                if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
                    break;
                }
                if (window.scrollY > 20000) break;
            }
        });

        await new Promise(r => setTimeout(r, 2000));
        await page.screenshot({ path: 'debug.png', fullPage: true });
        
        console.log("Extracting data via Regex pattern matching...");
        const data = await page.evaluate(async () => {
            const items = {};
            
            const scrapeCurrentDOM = (isPermSweep) => {
                // Find all elements in the DOM
                const allElements = Array.from(document.querySelectorAll('*'));
                
                // Keep only elements that contain our necessary keywords
                const cards = allElements.filter(el => {
                    const t = el.textContent || "";
                    return t.includes("Value") && t.includes("Demand") && t.includes("Trend");
                });

                // Isolate the innermost container for each item (prevents scraping the whole page as one card)
                const innerCards = cards.filter(card => {
                    return !cards.some(other => card !== other && card.contains(other));
                });

                innerCards.forEach(card => {
                    // Extract text with guaranteed spacing between HTML nodes
                    let spacedText = "";
                    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
                    let node;
                    while (node = walker.nextNode()) {
                        const val = node.textContent.trim();
                        if (val) spacedText += val + " \n ";
                    }

                    // Use Regex to pull data regardless of layout or line breaks
                    const valMatch = spacedText.match(/Value[:\s]*([0-9\.]+[KMBT]?|N\/A)/i);
                    const demMatch = spacedText.match(/Demand[:\s]*([0-9]+\/10|SOON|N\/A)/i);
                    const trenMatch = spacedText.match(/Trend[:\s]*(Stable|Overpaid|Underpaid|SOON|N\/A)/i);

                    const value = valMatch ? valMatch[1].toUpperCase() : "0";
                    const demand = demMatch ? demMatch[1].toUpperCase() : "0";
                    
                    let trend = trenMatch ? trenMatch[1] : "Stable";
                    if (trend.toLowerCase() === "stable") trend = "Stable";
                    if (trend.toLowerCase() === "overpaid") trend = "Overpaid";
                    if (trend.toLowerCase() === "underpaid") trend = "Underpaid";
                    if (trend.toLowerCase() === "soon") trend = "SOON";

                    // Figure out the Name of the item
                    let name = "";
                    const lines = spacedText.split('\n').map(t => t.trim()).filter(t => t.length > 0);
                    const skipWords = [
                        "mythical", "legendary", "rare", "uncommon", "common", 
                        "limited", "gamepass", "new", "regular", "permanent",
                        "value", "demand", "trend"
                    ];

                    for (const line of lines) {
                        // The first line that isn't a skip word, number, or trend is the Name
                        if (
                            !skipWords.includes(line.toLowerCase()) &&
                            line.length > 2 &&
                            !line.match(/^[0-9\.]+[KMBT]?$/i) &&
                            !line.match(/^[0-9]+\/10$/) &&
                            !line.match(/^(Stable|Overpaid|Underpaid|SOON|N\/A)$/i)
                        ) {
                            name = line;
                            break;
                        }
                    }

                    if (name && value !== "0") {
                        const hasToggle = spacedText.toLowerCase().includes('regular') && 
                                          spacedText.toLowerCase().includes('permanent');
                        
                        if (isPermSweep && !hasToggle) return;
                        
                        let finalName = name;
                        if (isPermSweep && hasToggle && !name.toLowerCase().startsWith("permanent")) {
                            finalName = "Permanent " + name;
                        }
                        
                        items[finalName] = {
                            Value: value,
                            Demand: demand,
                            Trend: trend
                        };
                    }
                });
            };

            // Scrape Base Items
            scrapeCurrentDOM(false);

            // Toggle to Permanent variants
            const buttons = Array.from(document.querySelectorAll('*')).filter(el => 
                el.textContent.trim() === "Permanent" && el.children.length === 0
            );
            
            buttons.forEach(btn => {
                try { btn.click(); } catch (e) {}
            });

            // Scrape Permanent Items
            return new Promise(resolve => {
                setTimeout(() => {
                    scrapeCurrentDOM(true);
                    resolve(items);
                }, 2000);
            });
        });

        console.log(`Found ${Object.keys(data).length} items.`);

        if (Object.keys(data).length > 0) {
            fs.writeFileSync('values.json', JSON.stringify(data, null, 2));
            console.log("Successfully updated values.json");
        } else {
            console.error("ERROR: Scraper returned 0 items. Throwing error to fail GitHub Action.");
            process.exit(1); 
        }
        
        await browser.close();
    } catch (error) {
        console.error("Scraper execution failed:", error);
        process.exit(1);
    }
})();
