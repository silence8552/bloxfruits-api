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
        
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'domcontentloaded' });
        
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 200;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeight || totalHeight > 10000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 150);
            });
        });

        await new Promise(r => setTimeout(r, 5000));
        
        await page.screenshot({ path: 'debug.png', fullPage: true });
        
        const data = await page.evaluate(async () => {
            const items = {};
            
            const scrapeCurrentDOM = (isPerm) => {
                const allElements = document.querySelectorAll('div, a');
                
                allElements.forEach(el => {
                    const text = el.innerText || "";
                    if (text.includes("Value") && text.includes("Demand") && text.includes("Trend")) {
                        const lines = text.split('\n').map(t => t.trim()).filter(t => t.length > 0);
                        
                        const name = lines[0];
                        
                        if (!name || name.includes("Value List") || name.includes("Regular") || lines.length > 30) return;
                        
                        let value = "0";
                        let demand = "0";
                        let trend = "Stable";
                        
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i] === "Value" && lines[i+1]) value = lines[i+1];
                            if (lines[i] === "Demand" && lines[i+1]) demand = lines[i+1];
                            if (lines[i] === "Trend" && lines[i+1]) trend = lines[i+1];
                        }
                        
                        const finalName = isPerm ? "Permanent " + name : name;
                        
                        if (!items[finalName] && value !== "0") {
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

        fs.writeFileSync('values.json', JSON.stringify(data, null, 2));
        await browser.close();
    } catch (error) {
        process.exit(1);
    }
})();
