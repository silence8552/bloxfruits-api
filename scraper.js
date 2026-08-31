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
        
        // Anti-Bot Check: Fail early if Cloudflare blocks the GitHub IP
        const pageTitle = await page.title();
        console.log("Page Title:", pageTitle);
        if (pageTitle.toLowerCase().includes("moment") || pageTitle.toLowerCase().includes("cloudflare")) {
            console.error("ERROR: Cloudflare block detected!");
            process.exit(1);
        }

        console.log("Scrolling page to load all items...");
        await page.evaluate(async () => {
            const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            while (true) {
                window.scrollBy(0, 1000);
                await delay(1000); // 1s delay per scroll ensures skeleton loaders trigger and resolve
                if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
                    break;
                }
                if (window.scrollY > 30000) break; 
            }
        });

        await new Promise(r => setTimeout(r, 2000));
        await page.screenshot({ path: 'debug.png', fullPage: true });
        
        console.log("Extracting raw page text...");
        // Extracting raw innerText ignores HTML structure entirely and reads the page like a human
        const pageTextNormal = await page.evaluate(() => document.body.innerText || "");
        
        if (!pageTextNormal || pageTextNormal.trim() === "") {
             console.error("ERROR: Extracted text is empty. Page may not have loaded.");
             process.exit(1);
        }

        // Print a snippet of what the scraper "sees" to the GitHub Actions log for debugging
        console.log("Raw text snippet (first 300 chars):\n", pageTextNormal.substring(0, 300).replace(/\n/g, '\\n'));

        console.log("Switching to Permanent view...");
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, div, span'));
            const permButton = elements.find(el => {
                const text = (el.innerText || "").toLowerCase().trim();
                return text === "permanent" || text === "perm";
            });
            if (permButton) {
                try { permButton.click(); } catch(e) {}
            }
        });

        await new Promise(r => setTimeout(r, 2000));
        const pageTextPerm = await page.evaluate(() => document.body.innerText || "");

        console.log("Parsing text data...");
        const items = {};

        const parseText = (rawText, isPerm) => {
            // Split all text on the page into a line-by-line array
            const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const skipWords = ["mythical", "legendary", "rare", "uncommon", "common", "limited", "gamepass", "new", "value", "demand", "trend", "regular", "permanent", "fruits", "blox", "list", "search"];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].toLowerCase();
                
                // Fully case-insensitive check for Value
                if (line === "value" || line.startsWith("value:") || line.startsWith("value ")) {
                    
                    let value = "0";
                    if (line === "value" && lines[i+1]) {
                        value = lines[i+1];
                    } else {
                        value = lines[i].replace(/value/i, '').replace(':', '').trim();
                    }

                    // Look ahead for Demand
                    let demand = "0";
                    for(let j = i; j <= Math.min(lines.length - 1, i + 5); j++) {
                        const dl = lines[j].toLowerCase();
                        if (dl === "demand" && lines[j+1]) demand = lines[j+1];
                        else if (dl.startsWith("demand:") || dl.startsWith("demand ")) demand = lines[j].replace(/demand/i, '').replace(':', '').trim();
                    }

                    // Look ahead for Trend
                    let trend = "Stable";
                    for(let j = i; j <= Math.min(lines.length - 1, i + 5); j++) {
                        const tl = lines[j].toLowerCase();
                        if (tl === "trend" && lines[j+1]) trend = lines[j+1];
                        else if (tl.startsWith("trend:") || tl.startsWith("trend ")) trend = lines[j].replace(/trend/i, '').replace(':', '').trim();
                    }

                    // Look backwards up to 6 lines to find the item's name
                    let name = "";
                    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
                        const nl = lines[j];
                        // Discard line if it's a structural word, a raw number, or a fraction like 10/10
                        if (
                            !skipWords.includes(nl.toLowerCase()) && 
                            !nl.match(/^[0-9\.]+[KMBT]?$/i) && 
                            !nl.match(/^[0-9]+\/10$/) &&
                            nl.length > 2
                        ) {
                            name = nl;
                            break;
                        }
                    }

                    if (name && value && value !== "0" && !value.toLowerCase().includes("demand")) {
                        let finalName = name;
                        if (isPerm && !name.toLowerCase().startsWith("permanent")) {
                            finalName = "Permanent " + name;
                        }
                        
                        items[finalName] = {
                            Value: value.toUpperCase(),
                            Demand: demand.toUpperCase(),
                            Trend: trend
                        };
                    }
                }
            }
        };

        parseText(pageTextNormal, false);
        parseText(pageTextPerm, true);

        console.log(`Found ${Object.keys(items).length} items.`);

        if (Object.keys(items).length > 0) {
            fs.writeFileSync('values.json', JSON.stringify(items, null, 2));
            console.log("Successfully updated values.json");
        } else {
            console.error("ERROR: Scraper parsed 0 items. Throwing error to fail GitHub Action.");
            process.exit(1); 
        }
        
        await browser.close();
    } catch (error) {
        console.error("Scraper execution failed:", error);
        process.exit(1);
    }
})();
