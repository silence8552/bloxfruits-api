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
        
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'networkidle2' });
        
        const data = await page.evaluate(() => {
            const items = {};
            const cards = document.querySelectorAll('a[href*="/v/"]'); 
            
            cards.forEach(card => {
                const nameElement = card.querySelector('h2, .text-xl, .font-bold');
                if (!nameElement) return;
                
                const name = nameElement.innerText.trim();
                const texts = Array.from(card.querySelectorAll('span, p, div')).map(el => el.innerText.trim());
                
                let value = "0";
                let demand = "0";
                let trend = "Stable";
                
                for (let i = 0; i < texts.length; i++) {
                    if (texts[i] === "Value" && texts[i+1]) value = texts[i+1];
                    if (texts[i] === "Demand" && texts[i+1]) demand = texts[i+1];
                    if (texts[i] === "Trend" && texts[i+1]) trend = texts[i+1];
                }
                
                items[name] = {
                    Value: value,
                    Demand: demand,
                    Trend: trend
                };
            });
            return items;
        });

        fs.writeFileSync('values.json', JSON.stringify(data, null, 2));

        await browser.close();
    } catch (error) {
        process.exit(1);
    }
})();
