const fs = require('fs');
const https = require('https');

const COSTCO_URL = 'https://www.costco.com.tw/c/hot-buys';

function fetchHTML(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchHTML(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function scrape() {
    console.log('正在抓取好市多資料...');
    try {
        const html = await fetchHTML(COSTCO_URL);
        
        // 使用正則表達式解析商品資料
        // 注意：這裡針對好市多實際的 HTML 結構進行了匹配
        const products = [];
        
        // 匹配商品區塊
        const itemRegex = /<div class="product-list-item">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
        let match;

        while ((match = itemRegex.exec(html)) !== null) {
            const content = match[1];
            
            // 提取名稱、價格與圖片
            const nameMatch = content.match(/class="js-lister-name"[^>]*>([\s\S]*?)<\/a>/);
            const priceMatch = content.match(/class="price"[^>]*>([\s\S]*?)<\/span>/);
            const imgMatch = content.match(/<img[^>]*src="([^"]*)"/);

            if (nameMatch && priceMatch) {
                products.push({
                    name: nameMatch[1].replace(/<[^>]*>/g, '').trim(),
                    price: priceMatch[1].replace(/<[^>]*>/g, '').trim(),
                    img: imgMatch ? (imgMatch[1].startsWith('http') ? imgMatch[1] : 'https://www.costco.com.tw' + imgMatch[1]) : ''
                });
            }
        }

        if (products.length === 0) {
            // 備用匹配方案 (如果上面的 regex 太嚴格)
            console.log('嘗試備用解析方案...');
            const altNameRegex = /"name":"([^"]+)"/g;
            const altPriceRegex = /"price":"([^"]+)"/g;
            // ... 這裡可以根據實際 HTML 調整
        }

        if (products.length === 0) throw new Error('解析不到任何商品，請檢查官網 HTML 結構');

        const output = {
            updated_at: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
            items: products
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log(`✅ 成功抓取 ${products.length} 項商品！`);
    } catch (err) {
        console.error('❌ 抓取失敗:', err.message);
        process.exit(1);
    }
}

scrape();
