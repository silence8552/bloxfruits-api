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
        
        console.log("Scrolling page to trigger lazy loading...");
        await page.evaluate(async () => {
            const delay = (ms) => new Promise(r => setTimeout(r, ms));
            // Slower, consistent scrolling to guarantee the skeleton loaders populate
            for(let i = 0; i < 20; i++) {
                window.scrollBy(0, 800);
                await delay(500);
            }
        });

        await new Promise(r => setTimeout(r, 2000));
        await page.screenshot({ path: 'debug.png', fullPage: true });

        console.log("Extracting data...");

        // Reusable function to scrape items, which we will call twice (once for base, once for perm)
        const getItems = async (isPerm) => {
            return await page.evaluate((isPerm) => {
                const items = {};
                
                // 1. Find every element on the page
                const allEls = Array.from(document.querySelectorAll('*'));
                
                // 2. ONLY keep elements that contain a Demand fraction (e.g. "8/10" or "10/10")
                // This completely ignores SEO text, headers, and trade ads.
                const cards = allEls.filter(el => {
                    const txt = el.innerText || "";
                    return txt.match(/[0-9]+\/10/);
                });

                // 3. Keep only the innermost wrappers to avoid parsing the parent container multiple times
                const innerCards = cards.filter(c => !cards.some(other => c !== other && c.contains(other)));

                innerCards.forEach(card => {
                    const rawText = card.innerText || "";
                    // Split by newlines, clean up spaces, and flatten into a single string
                    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l);
                    const flatText = lines.join(' ');

                    // Fallback defaults
                    let value = "0";
                    let demand = "0";
                    let trend = "Stable";

                    // Extract Value (Looks for the word Value, then grabs the number and M/B/K/T)
                    const vMatch = flatText.match(/Value\s*([0-9\.]+[KMBT]?|N\/A)/i);
                    if (vMatch) {
                        value = vMatch[1];
                    } else {
                        // Hard fallback if the word "Value" is missing but a number exists
                        const fallback = flatText.match(/\b([0-9\.]+[KMBT])\b/i);
                        if (fallback) value = fallback[1];
                    }

                    // Extract Demand (Locks onto the X/10 format)
                    const dMatch = flatText.match(/([0-9]+\/10|SOON|N\/A)/i);
                    if (dMatch) demand = dMatch[1];

                    // Extract Trend
                    const tMatch = flatText.match(/(Stable|Overpaid|Underpaid|SOON)/i);
                    if (tMatch) {
                        const tLower = tMatch[1].toLowerCase();
                        if (tLower === 'stable') trend = "Stable";
                        if (tLower === 'overpaid') trend = "Overpaid";
                        if (tLower === 'underpaid') trend = "Underpaid";
                        if (tLower === 'soon') trend = "SOON";
                    }

                    // Extract Name (Takes the first line that isn't a category header or a button)
                    const skipWords = ["mythical", "legendary", "rare", "uncommon", "common", "limited", "gamepass", "new", "value", "demand", "trend", "physical", "permanent", "regular", "buy", "sell"];
                    let name = "";
                    for (const line of lines) {
                        if (!skipWords.includes(line.toLowerCase()) && !line.match(/[0-9]/) && line.length > 2) {
                            name = line;
                            break;
                        }
                    }

                    // Save the item
                    if (name && value && value !== "0") {
                        let finalName = name;
                        
                        // Add "Permanent " prefix if we are in the Perm Sweep
                        if (isPerm && !name.toLowerCase().startsWith("permanent")) {
                            finalName = "Permanent " + name;
                        }
                        
                        items[finalName] = {
                            Value: value.toUpperCase(),
                            Demand: demand.toUpperCase(),
                            Trend: trend
                        };
                    }
                });
                
                return items;
            }, isPerm);
        };

        // Scrape Base Items
        console.log("Scraping base items...");
        const baseItems = await getItems(false);

        // Click the Permanent tab/button
        console.log("Switching to Permanent view...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const permBtn = btns.find(b => (b.innerText || "").toLowerCase().trim() === "permanent");
            if (permBtn) { 
                try { permBtn.click(); } catch(e) {} 
            }
        });

        // Wait for values to update
        await new Promise(r => setTimeout(r, 2000));

        // Scrape Permanent Items
        console.log("Scraping permanent items...");
        const permItems = await getItems(true);

        // Merge both dictionaries together to match your required formatting
        const finalData = { ...baseItems, ...permItems };

        console.log(`Successfully parsed ${Object.keys(finalData).length} real items!`);

        // Validate and Save
        if (Object.keys(finalData).length > 0) {
            fs.writeFileSync('values.json', JSON.stringify(finalData, null, 2));
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
