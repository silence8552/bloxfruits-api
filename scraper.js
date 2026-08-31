const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

(async () => {
    try {
        console.log("Launching headless browser...");
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'] 
        });
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Block heavy assets to prevent timeouts, but allow scripts to fetch the live data
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'media', 'stylesheet', 'font'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log("Navigating to site...");
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        console.log("Waiting for LIVE data to render...");
        await page.waitForFunction(() => document.body.innerText.match(/[0-9]+\/10/), { timeout: 45000 });

        console.log("Scrolling page to trigger lazy loading...");
        await page.evaluate(async () => {
            for(let i=0; i<15; i++) {
                window.scrollBy(0, 1000);
                await new Promise(r => setTimeout(r, 400));
            }
        });

        const getItems = async (isPerm) => {
            return await page.evaluate((isPerm) => {
                const items = {};
                
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                const words = [];
                let n;
                while(n = walker.nextNode()) {
                    const text = n.textContent.trim();
                    if(text) words.push(text);
                }

                for (let i = 0; i < words.length; i++) {
                    const w = words[i].toLowerCase();
                    
                    // 1. ANCHOR: Find the Demand fraction
                    if (w.match(/^[0-9]+\/10$/)) {
                        const demand = w.match(/[0-9]+\/10/)[0].toUpperCase();
                        
                        // 2. Look forward AND backward for Trend (Gamepasses put Trend before Demand)
                        let trend = "Stable";
                        for (let j = -6; j <= 6; j++) {
                            if (words[i+j]) {
                                const t = words[i+j].toLowerCase();
                                if (t === "overpaid") { trend = "Overpaid"; break; }
                                if (t === "underpaid") { trend = "Underpaid"; break; }
                                if (t === "stable") { trend = "Stable"; break; }
                                if (t === "soon") { trend = "SOON"; break; }
                            }
                        }
                        
                        // 3. Look backward for Value
                        let value = "0";
                        let valIdx = -1;
                        for (let j = 1; j <= 8; j++) {
                            if (words[i-j]) {
                                const v = words[i-j].toUpperCase();
                                if (v.match(/^[0-9\.]+[KMBT]$/) || v === "N/A" || v.match(/^[0-9]+$/)) {
                                    value = v;
                                    valIdx = i - j;
                                    break;
                                }
                            }
                        }
                        
                        // 4. Look backward for Name
                        let name = "";
                        const exactSkip = ["mythical", "legendary", "rare", "uncommon", "common", "gamepass", "new", "regular", "permanent", "value", "demand", "trend", "limited"];
                        
                        if (valIdx !== -1) {
                            for (let j = 1; j <= 12; j++) {
                                if (words[valIdx-j]) {
                                    const cand = words[valIdx-j];
                                    const cLow = cand.toLowerCase();
                                    
                                    // Skip exact category words
                                    if (exactSkip.includes(cLow)) continue;
                                    
                                    // Skip website UI text (Robux price, Updated X days ago)
                                    if (cLow.startsWith("updated") || cLow.startsWith("robux")) continue;
                                    
                                    // Skip pure numbers or value/demand formatting
                                    if (cand.match(/^[0-9\.]+[KMBT]?$/i) || cand.match(/^[0-9]+\/10$/) || cand.match(/^[0-9]+$/)) continue;
                                    
                                    if (cand.length >= 2) {
                                        name = cand;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // 5. Check if it's eligible for a Permanent variant
                        let canBePermanent = false;
                        if (valIdx !== -1) {
                            for (let j = 1; j <= 20; j++) {
                                if (words[valIdx-j] && (words[valIdx-j].toLowerCase() === "regular" || words[valIdx-j].toLowerCase() === "permanent")) {
                                    canBePermanent = true;
                                    break;
                                }
                            }
                        }

                        if (name && value !== "0" && !name.toLowerCase().includes("features")) {
                            if (isPerm && !canBePermanent) continue;
                            
                            let finalName = name;
                            if (isPerm && !finalName.toLowerCase().startsWith("permanent")) {
                                finalName = "Permanent " + finalName;
                            }
                            
                            items[finalName] = {
                                Value: value,
                                Demand: demand,
                                Trend: trend
                            };
                        }
                    }
                }
                
                return items;
            }, isPerm);
        };

        console.log("Extracting BASE live data...");
        const baseItems = await getItems(false);

        console.log("Switching to Permanent view...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const permBtn = btns.find(b => (b.textContent || "").toLowerCase().trim() === "permanent");
            if (permBtn) try { permBtn.click(); } catch(e) {}
        });

        await new Promise(r => setTimeout(r, 2000));
        
        console.log("Extracting PERMANENT live data...");
        const permItems = await getItems(true);
        const finalData = { ...baseItems, ...permItems };

        await browser.close();

        const itemCount = Object.keys(finalData).length;
        console.log(`Successfully scraped ${itemCount} live items!`);

        if (itemCount === 0) {
            console.error("ERROR: Extracted 0 items.");
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
