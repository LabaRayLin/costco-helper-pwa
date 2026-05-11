const fs = require('fs');
const https = require('https');

// 直接使用好市多內部的 REST API 介面
const API_URL = 'https://www.costco.com.tw/rest/v2/taiwan/products/search?fields=products(code,name,summary,price(FULL),images(DEFAULT),stock(FULL),averageRating,variantOptions)&query=:relevance:allCategories:hot-buys&pageSize=100&lang=zh_TW&curr=TWD';

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://www.costco.com.tw/c/hot-buys'
            }
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchJSON(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`API 請求失敗，狀態碼: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('JSON 解析失敗: ' + e.message));
                }
            });
        }).on('error', reject);
    });
}

async function scrape() {
    console.log('正在透過 API 抓取好市多優惠資料...');
    try {
        const data = await fetchJSON(API_URL);
        
        if (!data.products || !Array.isArray(data.products)) {
            throw new Error('API 回傳格式不符，找不到 products 陣列');
        }

        const products = data.products.map(item => {
            // 尋找主圖片 (通常是第一張 PRIMARY 或 DEFAULT)
            const primaryImage = item.images && item.images.find(img => img.format === 'product' || img.imageType === 'PRIMARY');
            const imgUrl = primaryImage ? (primaryImage.url.startsWith('http') ? primaryImage.url : 'https://www.costco.com.tw' + primaryImage.url) : '';

            return {
                code: item.code,
                name: item.name,
                price: item.price ? item.price.formattedValue : '點入確認價格',
                img: imgUrl
            };
        });

        if (products.length === 0) throw new Error('目前 API 回傳 0 項商品');

        const output = {
            updated_at: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
            count: products.length,
            items: products
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log(`✅ 成功抓取 ${products.length} 項商品！資料已更新。`);
    } catch (err) {
        console.error('❌ 抓取失敗:', err.message);
        process.exit(1);
    }
}

scrape();
