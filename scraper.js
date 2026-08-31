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
            
            const scrapeCurrentDOM = (isPermSweep) => {
                const allDivs = Array.from(document.querySelectorAll('div'));
                const cards = allDivs.filter(div => {
                    const text = div.innerText || "";
                    return text.includes("Value") && text.includes("Demand") && text.split('\n').length < 35;
                });

                const innerCards = cards.filter(card => {
                    return !cards.some(other => card !== other && card.contains(other));
                });

                innerCards.forEach(card => {
                    const textLines = card.innerText.split('\n').map(t => t.trim()).filter(t => t);
                    
                    let value = "0";
                    let demand = "0";
                    let trend = "Stable";
                    let valIndex = -1;
                    
                    for (let i = 0; i < textLines.length; i++) {
                        const line = textLines[i].toLowerCase();
                        if (line === "value") { value = textLines[i+1]; valIndex = i; }
                        else if (line.startsWith("value:") || line.startsWith("value ")) { value = textLines[i].replace(/value/i, '').replace(':', '').trim(); valIndex = i; }
                        
                        if (line === "demand") demand = textLines[i+1];
                        else if (line.startsWith("demand:") || line.startsWith("demand ")) demand = textLines[i].replace(/demand/i, '').replace(':', '').trim();
                        
                        if (line === "trend") trend = textLines[i+1];
                        else if (line.startsWith("trend:") || line.startsWith("trend ")) trend = textLines[i].replace(/trend/i, '').replace(':', '').trim();
                    }
                    
                    if (value !== "0" && value !== undefined) {
                        const skipWords = ["MYTHICAL", "LEGENDARY", "RARE", "UNCOMMON", "COMMON", "NEW", "LIMITED", "GAMEPASS"];
                        let name = "";
                        const limit = valIndex !== -1 ? valIndex : textLines.length;
                        for(let i = 0; i < limit; i++) {
                            if (!skipWords.includes(textLines[i].toUpperCase()) && textLines[i].length > 2) {
                                name = textLines[i];
                                break;
                            }
                        }
                        
                        if (name) {
                            const hasToggle = card.innerText.includes("Regular") && card.innerText.includes("Permanent");
                            if (isPermSweep && !hasToggle) return;
                            
                            let finalName = name;
                            if (isPermSweep && hasToggle && !name.toLowerCase().startsWith("permanent")) {
                                finalName = "Permanent " + name;
                            }
                            
                            items[finalName] = { Value: value, Demand: demand, Trend: trend };
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
