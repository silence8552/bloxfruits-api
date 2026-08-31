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
        
        console.log("Scrolling all containers to trigger lazy loading...");
        await page.evaluate(async () => {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            for(let i = 0; i < 20; i++) {
                // Scroll the main window
                window.scrollBy(0, 1000);
                // Force-scroll any internal React containers holding the items
                document.querySelectorAll('div').forEach(d => {
                    if (d.scrollHeight > d.clientHeight) d.scrollBy(0, 1000);
                });
                await delay(500);
            }
        });

        await new Promise(r => setTimeout(r, 2000));
        await page.screenshot({ path: 'debug.png', fullPage: true });

        console.log("Extracting data...");

        const getItems = async (isPerm) => {
            return await page.evaluate((isPerm) => {
                const items = {};
                
                // 1. Grab EVERY raw text node from the DOM tree. 
                // This ignores all CSS, invisible layouts, and headless rendering bugs.
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                const nodes = [];
                let n;
                while(n = walker.nextNode()) {
                    const t = n.textContent.trim();
                    if(t) nodes.push(t);
                }

                // 2. Loop through the flat text array to find items
                for (let i = 0; i < nodes.length; i++) {
                    const nodeLower = nodes[i].toLowerCase();
                    
                    let isValue = false;
                    let valueStr = "0";
                    
                    // Identify if this word is "Value" or "Value: 3.91B"
                    if (nodeLower === "value" && nodes[i+1]) {
                        isValue = true;
                        valueStr = nodes[i+1];
                    } else if (nodeLower.startsWith("value:") || nodeLower.startsWith("value ")) {
                        isValue = true;
                        valueStr = nodes[i].replace(/value/i, '').replace(':', '').trim();
                    }
                    
                    if (isValue) {
                        let demandStr = "0";
                        let trendStr = "Stable";
                        
                        // Look ahead up to 8 words to find Demand and Trend
                        for (let j = 0; j <= 8; j++) {
                            if (!nodes[i+j]) continue;
                            const lookLower = nodes[i+j].toLowerCase();
                            
                            if (lookLower === "demand" && nodes[i+j+1]) demandStr = nodes[i+j+1];
                            else if (lookLower.startsWith("demand:") || lookLower.startsWith("demand ")) demandStr = nodes[i+j].replace(/demand/i, '').replace(':', '').trim();
                            
                            if (lookLower === "trend" && nodes[i+j+1]) trendStr = nodes[i+j+1];
                            else if (lookLower.startsWith("trend:") || lookLower.startsWith("trend ")) trendStr = nodes[i+j].replace(/trend/i, '').replace(':', '').trim();
                        }
                        
                        // Clean up parsed data
                        if (demandStr.includes("/")) demandStr = demandStr.split(" ")[0]; 
                        
                        const tMatch = trendStr.match(/(Stable|Overpaid|Underpaid|SOON)/i);
                        if (tMatch) {
                            const tl = tMatch[1].toLowerCase();
                            if(tl === 'stable') trendStr = 'Stable';
                            if(tl === 'overpaid') trendStr = 'Overpaid';
                            if(tl === 'underpaid') trendStr = 'Underpaid';
                            if(tl === 'soon') trendStr = 'SOON';
                        }
                        
                        // Look backward up to 8 words to find the Item Name
                        let nameStr = "";
                        const skip = [
                            "mythical", "legendary", "rare", "uncommon", "common", "gamepass", 
                            "regular", "permanent", "new", "limited", "value", "demand", "trend", 
                            "trade", "ads", "calculator", "list", "search", "fruits", "tracking", 
                            "features", "update", "buy", "sell", "home", "discord"
                        ];
                        
                        for (let j = 1; j <= 8; j++) {
                            if (!nodes[i-j]) continue;
                            const cand = nodes[i-j];
                            const cLow = cand.toLowerCase();
                            
                            // A valid name is not a skip word, not a number, and isn't website SEO text
                            if (!skip.includes(cLow) && 
                                cand.length > 2 && 
                                !cand.match(/^[0-9\.]+[KMBT]?$/i) && 
                                !cand.match(/^[0-9]+\s*\/\s*10$/) && 
                                !cand.includes("Blox Fruits features")) {
                                nameStr = cand;
                                break; 
                            }
                        }
                        
                        // Validate and save to dictionary
                        if (nameStr && valueStr !== "0" && !valueStr.toLowerCase().includes("demand") && !valueStr.toLowerCase().includes("list")) {
                            let finalName = nameStr;
                            if (isPerm && !nameStr.toLowerCase().startsWith("permanent")) {
                                finalName = "Permanent " + nameStr;
                            }
                            
                            items[finalName] = {
                                Value: valueStr.toUpperCase(),
                                Demand: demandStr.toUpperCase(),
                                Trend: trendStr
                            };
                        }
                    }
                }
                
                return items;
            }, isPerm);
        };

        console.log("Scraping base items...");
        const baseItems = await getItems(false);

        console.log("Switching to Permanent view...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const permBtn = btns.find(b => {
                const text = (b.textContent || "").toLowerCase().trim();
                return text.includes("permanent") && text.length < 15;
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
