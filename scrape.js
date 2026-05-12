const fs = require('fs');
const https = require('https');

// 好市多內部的 REST API 基礎 URL (不帶分頁參數)
const BASE_API_URL = 'https://www.costco.com.tw/rest/v2/taiwan/products/search?fields=products(code,name,summary,price(FULL),images(DEFAULT),stock(FULL),averageRating,variantOptions),pagination(totalPages,totalResults,number)&pageSize=100&lang=zh_TW&curr=TWD';

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://www.costco.com.tw/p/search'
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
    console.log('正在準備抓取好市多全站商品資料...');
    let allProducts = [];
    let currentPage = 0;
    let totalPages = 1;

    try {
        // 絕對安全模式：使用原始確定的 hot-buys 查詢
        const initialUrl = `https://www.costco.com.tw/rest/v2/taiwan/products/search?fields=products(code,name,summary,price(FULL),images(DEFAULT),stock(FULL),averageRating,variantOptions)&query=:relevance:allCategories:hot-buys&pageSize=100&lang=zh_TW&curr=TWD&currentPage=0`;
        console.log(`正在發送初始請求: ${initialUrl}`);
        const firstPage = await fetchJSON(initialUrl);
        
        if (!firstPage || !firstPage.products) {
            console.error('API 回傳異常，完整內容:', JSON.stringify(firstPage));
            throw new Error('API 回傳格式不符，找不到 products 陣列');
        }

        if (firstPage.pagination) {
            totalPages = firstPage.pagination.totalPages;
            console.log(`✅ 初始請求成功！總共有 ${totalPages} 頁，共 ${firstPage.pagination.totalResults} 項商品。`);
        } else {
            console.warn('⚠️ 找不到分頁資訊，將僅抓取第一頁。');
        }

        // 開始循環抓取每一頁 (限制最大抓取頁數避免 Action 超時)
        const MAX_PAGES = 150; 
        const pagesToFetch = Math.min(totalPages, MAX_PAGES);

        for (currentPage = 0; currentPage < pagesToFetch; currentPage++) {
            console.log(`[${currentPage + 1}/${pagesToFetch}] 正在抓取商品...`);
            const url = `https://www.costco.com.tw/rest/v2/taiwan/products/search?fields=products(code,name,summary,price(FULL),images(DEFAULT),stock(FULL),averageRating,variantOptions)&query=:relevance:allCategories:hot-buys&pageSize=100&lang=zh_TW&curr=TWD&currentPage=${currentPage}`;
            
            try {
                const data = await fetchJSON(url);
                if (data.products && Array.isArray(data.products)) {
                    const pageProducts = data.products.map(item => {
                        const primaryImage = item.images && item.images.find(img => img.format === 'product' || img.imageType === 'PRIMARY');
                        const imgUrl = primaryImage ? (primaryImage.url.startsWith('http') ? primaryImage.url : 'https://www.costco.com.tw' + primaryImage.url) : '';

                        let discount = 0;
                        if (item.summary) {
                            const discountMatch = item.summary.match(/color:red[^>]*>\$([\d,]+)/);
                            if (discountMatch) {
                                discount = parseInt(discountMatch[1].replace(/,/g, ''), 10);
                            }
                        }

                        const currentPriceValue = item.price ? item.price.value : 0;
                        const originalPriceValue = currentPriceValue + discount;

                        return {
                            code: item.code,
                            name: item.name,
                            price: item.price ? item.price.formattedValue : '點入確認價格',
                            original_price: discount > 0 ? `$${originalPriceValue.toLocaleString()}` : null,
                            discount: discount > 0 ? `$${discount.toLocaleString()}` : null,
                            img: imgUrl
                        };
                    });
                    allProducts = allProducts.concat(pageProducts);
                    console.log(`   -> 已取得 ${pageProducts.length} 項商品 (累積: ${allProducts.length})`);
                }
            } catch (pageErr) {
                console.error(`❌ 第 ${currentPage + 1} 頁抓取跳過:`, pageErr.message);
            }

            // 稍作停頓避免被鎖 IP
            if (currentPage < pagesToFetch - 1) {
                await new Promise(r => setTimeout(r, 800));
            }
        }

        if (allProducts.length === 0) {
            throw new Error('抓取結束但未取得任何商品資訊。');
        }

        const output = {
            updated_at: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
            count: allProducts.length,
            items: allProducts
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log(`\n🎉 抓取完成！全站共 ${allProducts.length} 項商品資料已存入 data.json。`);
    } catch (err) {
        console.error('\n❌ 抓取程式發生嚴重錯誤:');
        console.error(err.message);
        process.exit(1);
    }
}

scrape();
