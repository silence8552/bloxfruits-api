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
        
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'networkidle2', timeout: 30000 });
        
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
        
        const data = await page.evaluate(async () => {
            const items = {};
            const skipHeaders = [
                "MYTHICAL", "LEGENDARY", "RARE", "UNCOMMON", 
                "COMMON", "LIMITED", "GAMEPASS", "VALUE"
            ];
            
            const scrapeCurrentDOM = (isPermSweep) => {
                const allElements = document.querySelectorAll('div, a');
                
                allElements.forEach(el => {
                    const text = el.innerText || "";
                    if (text.toLowerCase().includes("value") && text.toLowerCase().includes("demand")) {
                        const lines = text.split('\n').map(t => t.trim()).filter(t => t.length > 0);
                        const name = lines[0];
                        
                        if (!name || skipHeaders.includes(name.toUpperCase()) || name.includes("Value List") || lines.length > 30) return;
                        
                        const hasToggle = text.includes("Regular") && text.includes("Permanent");
                        
                        if (isPermSweep && !hasToggle) return;
                        
                        let value = "0";
                        let demand = "0";
                        let trend = "Stable";
                        
                        for (let i = 0; i < lines.length; i++) {
                            const currentLine = lines[i].toLowerCase();
                            
                            if (currentLine === "value" && lines[i+1]) value = lines[i+1];
                            else if (currentLine.startsWith("value")) value = lines[i].replace(/value/i, '').replace(':', '').trim();
                            
                            if (currentLine === "demand" && lines[i+1]) demand = lines[i+1];
                            else if (currentLine.startsWith("demand")) demand = lines[i].replace(/demand/i, '').replace(':', '').trim();
                            
                            if (currentLine === "trend" && lines[i+1]) trend = lines[i+1];
                            else if (currentLine.startsWith("trend")) trend = lines[i].replace(/trend/i, '').replace(':', '').trim();
                        }
                        
                        let finalName = name;
                        if (isPermSweep && hasToggle) {
                            if (!name.toLowerCase().startsWith("permanent")) {
                                finalName = "Permanent " + name;
                            }
                        }
                        
                        if (!items[finalName] && value !== "0" && value !== "") {
                            items[finalName] = {
                                Value: value,
                                Demand: demand,
                                Trend: trend
                            };
                        }
                    }
                });
            };

            scrapeCurrentDOM(false);

            const buttons = Array.from(document.querySelectorAll('button, div')).filter(el => 
                el.innerText && el.innerText.trim() === "Permanent"
            );
            
            buttons.forEach(btn => {
                try {
                    btn.click();
                } catch (e) {}
            });

            await new Promise(r => setTimeout(r, 2000));

            scrapeCurrentDOM(true);

            return items;
        });

        if (Object.keys(data).length > 0) {
            fs.writeFileSync('values.json', JSON.stringify(data, null, 2));
        } else {
            console.warn("WARNING: Scraper returned empty object. values.json was not overwritten.");
        }
        
        await browser.close();
    } catch (error) {
        console.error("Scraper execution failed:", error);
        process.exit(1);
    }
})();
