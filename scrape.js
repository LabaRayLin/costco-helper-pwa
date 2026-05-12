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
    console.log('🚀 開始全站商品分類掃描...');
    let allProductsMap = new Map(); // 使用 Map 避免重複商品
    
    // 好市多主要的大分類 ID (1-16) 以及特殊分類
    const CATEGORIES = [
        'hot-buys', 'new-items', 'only-online', 'treasure-hunt', 'last-chance',
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'
    ];

    try {
        for (const catId of CATEGORIES) {
            console.log(`\n📂 正在處理分類: ${catId}`);
            let totalPages = 1;
            
            // 第一步：獲取該分類的分頁資訊
            const initialUrl = `https://www.costco.com.tw/rest/v2/taiwan/products/search?fields=products(code,name,summary,price(FULL),images(DEFAULT),stock(FULL),averageRating,variantOptions),pagination&query=:relevance:allCategories:${catId}&pageSize=100&lang=zh_TW&curr=TWD&currentPage=0`;
            
            try {
                const firstPage = await fetchJSON(initialUrl);
                if (!firstPage || !firstPage.products) {
                    console.log(`   ⚠️ 分類 ${catId} 無資料，跳過。`);
                    continue;
                }

                if (firstPage.pagination) {
                    totalPages = firstPage.pagination.totalPages;
                }
                
                console.log(`   ✅ 發現 ${firstPage.pagination ? firstPage.pagination.totalResults : firstPage.products.length} 項商品，共 ${totalPages} 頁。`);

                // 第二步：抓取該分類下的所有頁面
                for (let page = 0; page < totalPages; page++) {
                    if (page > 0) console.log(`   -> 抓取第 ${page + 1}/${totalPages} 頁...`);
                    const url = `https://www.costco.com.tw/rest/v2/taiwan/products/search?fields=products(code,name,summary,price(FULL),basePrice(FULL),discountPrice(FULL),images(DEFAULT),stock(FULL),averageRating,variantOptions),pagination&query=:relevance:allCategories:${catId}&pageSize=100&lang=zh_TW&curr=TWD&currentPage=${page}`;
                    
                    const data = await fetchJSON(url);
                    if (data.products && Array.isArray(data.products)) {
                        data.products.forEach(item => {
                            const primaryImage = item.images && item.images.find(img => img.format === 'product' || img.imageType === 'PRIMARY');
                            const imgUrl = primaryImage ? (primaryImage.url.startsWith('http') ? primaryImage.url : 'https://www.costco.com.tw' + primaryImage.url) : '';

                            // 優先從 API 直接提供的欄位獲取折價資訊
                            const discountPrice = item.discountPrice?.value || 0;
                            const basePrice = item.basePrice?.value || 0;
                            
                            let discount = discountPrice;
                            let originalPrice = basePrice;

                            // 如果 API 沒給，嘗試從 summary 解析 (備援方案)
                            if (discount === 0 && item.summary) {
                                const discountMatch = item.summary.match(/color:red[^>]*>\$([\d,]+)/);
                                if (discountMatch) {
                                    discount = parseInt(discountMatch[1].replace(/,/g, ''), 10);
                                    originalPrice = (item.price?.value || 0) + discount;
                                }
                            }

                            allProductsMap.set(item.code, {
                                code: item.code,
                                name: item.name,
                                price: item.price ? item.price.formattedValue : '點入確認價格',
                                original_price: discount > 0 ? (item.basePrice?.formattedValue || `$${originalPrice.toLocaleString()}`) : null,
                                discount: discount > 0 ? (item.discountPrice?.formattedValue || `$${discount.toLocaleString()}`) : null,
                                img: imgUrl
                            });
                        });
                    }
                    if (page < totalPages - 1) await new Promise(r => setTimeout(r, 500));
                }
            } catch (catErr) {
                console.error(`   ❌ 分類 ${catId} 抓取中斷:`, catErr.message);
            }
            // 分類間隔
            await new Promise(r => setTimeout(r, 1000));
        }

        const finalProducts = Array.from(allProductsMap.values());
        const output = {
            updated_at: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
            count: finalProducts.length,
            items: finalProducts
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log(`\n🎉 任務達成！全站共抓取 ${finalProducts.length} 項不重複商品。`);
    } catch (err) {
        console.error('\n❌ 抓取程式發生嚴重錯誤:');
        console.error(err.message);
        process.exit(1);
    }
}

scrape();
