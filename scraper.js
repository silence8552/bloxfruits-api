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
        
        // FIX 1: Ignored ads by using domcontentloaded and doubled the timeout limit
        await page.goto('https://bloxfruitsvalues.com/values', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.evaluate(async () => {
            const delay = ms => new Promise(r => setTimeout(r, ms));
            for(let i = 0; i < 20; i++) {
                window.scrollBy(0, 1000);
                await delay(500);
            }
        });

        await new Promise(r => setTimeout(r, 2000));
        
        const getItems = async (isPerm) => {
            return await page.evaluate((isPerm) => {
                const items = {};
                const allEls = Array.from(document.querySelectorAll('*'));
                
                const validCards = allEls.filter(el => {
                    const text = el.innerText || "";
                    // FIX 2: Dropped char limit to 90 to block SEO paragraphs but allow long item names
                    return text.includes("Value") && 
                           text.includes("Demand") && 
                           text.includes("Trend") && 
                           text.match(/[0-9]+\/10/i) && 
                           text.length > 20 && 
                           text.length < 90; 
                });

                const innerCards = validCards.filter(card => !validCards.some(other => card !== other && card.contains(other)));

                innerCards.forEach(card => {
                    const lines = (card.innerText || "").split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    let value = "0", demand = "0", trend = "Stable", name = "";
                    const skip = ["mythical", "legendary", "rare", "uncommon", "common", "gamepass", "regular", "permanent", "new", "limited", "value", "demand", "trend", "buy", "sell"];

                    if (lines.length === 1 || !lines.some(l => l.toLowerCase() === "value")) {
                        const flatText = lines.join(" ");
                        const vMatch = flatText.match(/Value[:\s]*([0-9\.]+[KMBT]?|N\/A)/i);
                        if (vMatch) value = vMatch[1];
                        
                        const dMatch = flatText.match(/Demand[:\s]*([0-9]+\/10|SOON|N\/A)/i);
                        if (dMatch) demand = dMatch[1];
                        
                        const tMatch = flatText.match(/Trend[:\s]*(Stable|Overpaid|Underpaid|SOON)/i);
                        if (tMatch) trend = tMatch[1];
                        
                        const beforeValue = flatText.split(/Value/i)[0].trim();
                        const nameWords = beforeValue.split(/\s+/).filter(w => !skip.includes(w.toLowerCase()));
                        name = nameWords.join(" ");
                    } else {
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

        const baseItems = await getItems(false);

        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div, span'));
            const permBtn = btns.find(b => (b.innerText || "").toLowerCase().trim() === "permanent");
            if (permBtn) { try { permBtn.click(); } catch(e) {} }
        });

        await new Promise(r => setTimeout(r, 2000));
        
        const permItems = await getItems(true);
        const finalData = { ...baseItems, ...permItems };

        if (Object.keys(finalData).length > 0) {
            fs.writeFileSync('values.json', JSON.stringify(finalData, null, 2));
        } else {
            process.exit(1); 
        }
        
        await browser.close();
    } catch (error) {
        process.exit(1);
    }
})();
