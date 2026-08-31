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
            const delay = ms => new Promise(r => setTimeout(r, ms));
            for(let i = 0; i < 20; i++) {
                window.scrollBy(0, 1000);
                await delay(500);
            }
        });

        await new Promise(r => setTimeout(r, 2000));
        await page.screenshot({ path: 'debug.png', fullPage: true });

        console.log("Extracting items...");
        
        const getItems = async (isPerm) => {
            return await page.evaluate((isPerm) => {
                const items = {};
                
                // 1. Get every HTML element on the page
                const allEls = Array.from(document.querySelectorAll('*'));
                
                // 2. Quarantine: Filter for only valid item cards
                const validCards = allEls.filter(el => {
                    const text = el.innerText || "";
                    return text.includes("Value") && 
                           text.includes("Demand") && 
                           text.includes("Trend") && 
                           text.match(/[0-9]+\/10/i) && // MUST have a demand fraction
                           text.length > 20 && 
                           text.length < 250; // IMPOSSIBLE to scrape SEO paragraphs
                });

                // 3. Keep only the deepest innermost containers
                const innerCards = validCards.filter(card => !validCards.some(other => card !== other && card.contains(other)));

                innerCards.forEach(card => {
                    const lines = (card.innerText || "").split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    let value = "0", demand = "0", trend = "Stable", name = "";
                    const skip = ["mythical", "legendary", "rare", "uncommon", "common", "gamepass", "regular", "permanent", "new", "limited", "value", "demand", "trend", "buy", "sell"];

                    // If Headless Linux collapsed the text into one line, use Regex
                    if (lines.length === 1 || !lines.some(l => l.toLowerCase() === "value")) {
                        const flatText = lines.join(" ");
                        
                        const vMatch = flatText.match(/Value[:\s]*([0-9\.]+[KMBT]?|N\/A)/i);
                        if (vMatch) value = vMatch[1];
                        
                        const dMatch = flatText.match(/Demand[:\s]*([0-9]+\/10|SOON|N\/A)/i);
                        if (dMatch) demand = dMatch[1];
                        
                        const tMatch = flatText.match(/Trend[:\s]*(Stable|Overpaid|Underpaid|SOON)/i);
                        if (tMatch) trend = tMatch[1];
                        
                        // Extract Name: Take everything before "Value" and remove skip words
                        const beforeValue = flatText.split(/Value/i)[0].trim();
                        const nameWords = beforeValue.split(/\s+/).filter(w => !skip.includes(w.toLowerCase()));
                        name = nameWords.join(" ");
                    } 
                    // If text is neatly split by newlines, parse line-by-line
                    else {
                        lines.forEach((line, i) => {
                            const lower = line.toLowerCase();
                            
                            if (lower === "value" && lines[i+1]) value = lines[i+1];
                            else if (lower.startsWith("value:") || lower.startsWith("value ")) value = line.replace(/value/i, '').replace(':', '').trim();
                            
                            if (lower === "demand" && lines[i+1]) demand = lines[i+1];
                            else if (lower.startsWith("demand:") || lower.startsWith("demand ")) demand = line.replace(/demand/i, '').replace(':', '').trim();
                            
                            if (lower === "trend" && lines[i+1]) trend = lines[i+1];
                            else if (lower.startsWith("trend:") || lower.startsWith("trend ")) trend = line.replace(/trend/i, '').replace(':', '').trim();
                        });

                        for (const line of lines) {
                            if (!skip.includes(line.toLowerCase()) && !line.match(/^[0-9]/)) {
                                name = line;
                                break;
                            }
                        }
                    }

                    // Clean and Save
                    if (demand.includes("/")) demand = demand.split(" ")[0] + "/10";

                    if (name && value !== "0" && !value.toLowerCase().includes("list")) {
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
                });
                
                return items;
            }, isPerm);
        };

        console.log("Scraping base items...");
        const baseItems = await getItems(false);

        console.log("Switching to Permanent view...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const permBtn = btns.find(b => {
                const txt = (b.innerText || "").toLowerCase().trim();
                return txt === "permanent";
            });
            if (permBtn) { 
                try { permBtn.click(); } catch(e) {} 
            }
        });

        await new Promise(r => setTimeout(r, 2000));
        
        console.log("Scraping permanent items...");
        const permItems = await getItems(true);

        const finalData = { ...baseItems, ...permItems };

        console.log(`Successfully parsed ${Object.keys(finalData).length} real items!`);

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
