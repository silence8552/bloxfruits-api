const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

(async () => {
    try {
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'domcontentloaded' });
        
        await new Promise(r => setTimeout(r, 5000));
        
        await page.screenshot({ path: 'debug.png' });
        
        const data = await page.evaluate(() => {
            const items = {};
            const cards = document.querySelectorAll('div, a');
            
            cards.forEach(card => {
                const textContent = card.innerText || "";
                if (textContent.includes("Value") && textContent.includes("Demand") && textContent.includes("Trend")) {
                    const lines = textContent.split('\n').map(t => t.trim()).filter(t => t.length > 0);
                    const name = lines[0];
                    
                    if (!name || name.includes("Value List") || name.includes("Default View Mode")) return;
                    
                    let value = "0";
                    let demand = "0";
                    let trend = "Stable";
                    
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i] === "Value" && lines[i+1]) value = lines[i+1];
                        if (lines[i] === "Demand" && lines[i+1]) demand = lines[i+1];
                        if (lines[i] === "Trend" && lines[i+1]) trend = lines[i+1];
                    }
                    
                    if (!items[name]) {
                        items[name] = {
                            Value: value,
                            Demand: demand,
                            Trend: trend
                        };
                    }
                }
            });
            return items;
        });

        fs.writeFileSync('values.json', JSON.stringify(data, null, 2));
        await browser.close();
    } catch (error) {
        process.exit(1);
    }
})();
