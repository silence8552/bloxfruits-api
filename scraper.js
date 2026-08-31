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
        
        console.log("Extracting data via TreeWalker...");
        const data = await page.evaluate(async () => {
            const items = {};
            
            const scrapeCurrentDOM = (isPermSweep) => {
                const valueLabels = Array.from(document.querySelectorAll('*')).filter(el => 
                    el.textContent.trim() === 'Value' && el.children.length === 0
                );

                const processedCards = new Set();

                valueLabels.forEach(label => {
                    let card = label.parentElement;
                    while (card && !card.textContent.includes('Demand')) {
                        card = card.parentElement;
                        if (card === document.body) break;
                    }
                    if (!card || card === document.body || processedCards.has(card)) return;
                    processedCards.add(card);

                    // Extract raw text nodes bypassing CSS visual rendering issues
                    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null, false);
                    const textNodes = [];
                    let node;
                    while (node = walker.nextNode()) {
                        const t = node.textContent.trim();
                        if (t) textNodes.push(t);
                    }

                    let value = "0", demand = "0", trend = "Stable", name = "";
                    let valIdx = textNodes.indexOf("Value");
                    let demIdx = textNodes.indexOf("Demand");
                    let trenIdx = textNodes.indexOf("Trend");

                    if (valIdx !== -1 && textNodes[valIdx + 1]) value = textNodes[valIdx + 1];
                    if (demIdx !== -1 && textNodes[demIdx + 1]) demand = textNodes[demIdx + 1];
                    if (trenIdx !== -1 && textNodes[trenIdx + 1]) trend = textNodes[trenIdx + 1];
                    
                    const skip = ["mythical", "legendary", "rare", "uncommon", "common", "limited", "gamepass", "regular", "permanent", "new"];
                    
                    for (let i = 0; i < valIdx; i++) {
                        if (!skip.includes(textNodes[i].toLowerCase()) && textNodes[i].length > 1) {
                            name = textNodes[i];
                        }
                    }

                    if (name && value && value !== "0") {
                        const hasToggle = textNodes.some(t => t.toLowerCase() === 'regular') && textNodes.some(t => t.toLowerCase() === 'permanent');
                        
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

            // Scrape normal items
            scrapeCurrentDOM(false);

            // Click to Permanent view
            const buttons = Array.from(document.querySelectorAll('*')).filter(el => 
                el.textContent.trim() === "Permanent" && el.children.length === 0
            );
            
            buttons.forEach(btn => {
                try {
                    btn.click();
                } catch (e) {}
            });

            await new Promise(r => setTimeout(r, 2000));

            // Scrape permanent items
            scrapeCurrentDOM(true);

            return items;
        });

        console.log(`Found ${Object.keys(data).length} items.`);

        if (Object.keys(data).length > 0) {
            fs.writeFileSync('values.json', JSON.stringify(data, null, 2));
            console.log("Successfully updated values.json");
        } else {
            // Fails the GitHub Action to prevent your database from being wiped out
            console.error("ERROR: Scraper returned 0 items. Throwing error to fail GitHub Action.");
            process.exit(1); 
        }
        
        await browser.close();
    } catch (error) {
        console.error("Scraper execution failed:", error);
        process.exit(1);
    }
})();
