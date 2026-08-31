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
        
        // --- TIMEOUT FIX ---
        // Instantly block all ads, images, and styles so the page loads in < 2 seconds
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media', 'other'].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log("Navigating to site...");
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        console.log("Scrolling page to trigger lazy loading...");
        await page.evaluate(async () => {
            for(let i=0; i<15; i++) {
                window.scrollBy(0, 1000);
                await new Promise(r => setTimeout(r, 400));
            }
        });

        console.log("Extracting LIVE data...");
        const getItems = async (isPerm) => {
            return await page.evaluate((isPerm) => {
                const items = {};
                
                // Find cards that have a Demand fraction (e.g. 10/10)
                const nodes = Array.from(document.querySelectorAll('*')).filter(el => 
                    el.textContent.match(/^[0-9]+\/10$/) && el.children.length === 0
                );
                
                nodes.forEach(demandEl => {
                    let card = demandEl.parentElement;
                    // Go up the HTML tree to grab the whole item card
                    for(let i=0; i<4; i++) { if(card && card.parentElement) card = card.parentElement; }
                    
                    if(card) {
                        const rawText = card.textContent || "";
                        
                        // --- FAKE PERMANENT FIX ---
                        // Check if this specific item actually has the Permanent toggle buttons
                        const canBePermanent = rawText.toLowerCase().includes("regular") && rawText.toLowerCase().includes("permanent");

                        // If we are doing the Permanent sweep, but this item can't be permanent, skip it entirely.
                        if (isPerm && !canBePermanent) return;

                        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
                        let leaves = [];
                        let n;
                        while(n = walker.nextNode()) if(n.textContent.trim()) leaves.push(n.textContent.trim());

                        const valIdx = leaves.findIndex(l => l.toLowerCase() === 'value');
                        const demIdx = leaves.findIndex(l => l.toLowerCase() === 'demand');
                        const trenIdx = leaves.findIndex(l => l.toLowerCase() === 'trend');

                        if (valIdx !== -1 && demIdx !== -1 && trenIdx !== -1) {
                            const value = leaves[valIdx + 1];
                            const demand = leaves[demIdx + 1];
                            const trend = leaves[trenIdx + 1];

                            const skip = ["mythical", "legendary", "rare", "uncommon", "common", "gamepass", "new", "regular", "permanent"];
                            let name = "";
                            
                            // Grab the name by reading backwards from "Value"
                            for(let i=0; i < valIdx; i++) {
                                if (!skip.includes(leaves[i].toLowerCase())) {
                                    name = leaves[i];
                                    break;
                                }
                            }

                            if (name && value && value !== "0") {
                                let finalName = name;
                                // Only add the prefix if it is the Perm sweep AND the item has a valid perm toggle
                                if (isPerm && canBePermanent && !finalName.toLowerCase().startsWith("permanent")) {
                                    finalName = "Permanent " + finalName;
                                }
                                items[finalName] = { 
                                    Value: value.toUpperCase(), 
                                    Demand: demand.toUpperCase(), 
                                    Trend: trend 
                                };
                            }
                        }
                    }
                });
                return items;
            }, isPerm);
        };

        const baseItems = await getItems(false);

        console.log("Switching to Permanent view...");
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const permBtn = btns.find(b => (b.textContent || "").toLowerCase().trim() === "permanent");
            if (permBtn) try { permBtn.click(); } catch(e) {}
        });

        await new Promise(r => setTimeout(r, 2000));
        
        const permItems = await getItems(true);
        const finalData = { ...baseItems, ...permItems };

        await browser.close();

        const itemCount = Object.keys(finalData).length;
        console.log(`Successfully scraped ${itemCount} live items!`);

        // NO FALLBACK DATA: It either updates with live data or fails safely without overwriting.
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
