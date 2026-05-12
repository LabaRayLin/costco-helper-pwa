const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'data.json');

async function fetchJSON(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://www.costco.com.tw/'
            }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (err) {
        throw new Error(`Fetch failed: ${err.message}`);
    }
}

async function scrape() {
    console.log('🚀 開始全站商品分類掃描 (原生 Fetch 模式)...');
    let allProductsMap = new Map(); // 使用 Map 避免重複商品
    
    // 第一步：遞歸獲取所有子分類 ID
    async function getAllCategoryIds(catId) {
        let ids = [catId];
        try {
            const url = `https://www.costco.com.tw/rest/v2/taiwan/catalogs/taiwanProductCatalog/Online/categories/${catId}/subcategories`;
            const data = await fetchJSON(url);
            if (data.categories && Array.isArray(data.categories)) {
                for (const sub of data.categories) {
                    const subIds = await getAllCategoryIds(sub.id);
                    ids = ids.concat(subIds);
                }
            }
        } catch (err) {
            console.error(`   ⚠️ 分類 ${catId} 子類獲取失敗:`, err.message);
        }
        return [...new Set(ids)];
    }

    console.log('🔍 正在掃描全站分類結構...');
    const rootCategories = [
        'Warehouse-Only', 'Online-Only', 'hot-buys', 'last-chance', 'treasure-hunt', 'new-items',
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'
    ];
    let allCategoryIds = [];
    for (const root of rootCategories) {
        const ids = await getAllCategoryIds(root);
        allCategoryIds = allCategoryIds.concat(ids);
    }
    allCategoryIds = [...new Set(allCategoryIds)];
    console.log(`✅ 掃描完成，共發現 ${allCategoryIds.length} 個分類`);

    for (const catId of allCategoryIds) {
        console.log(`📦 正在處理分類: ${catId}...`);
        try {
            // 先拿第一頁確定總頁數
            const firstUrl = `https://www.costco.com.tw/rest/v2/taiwan/products/search?fields=products(code,name,summary,price(FULL),basePrice(FULL),discountPrice(FULL),images(DEFAULT),stock(FULL),averageRating,variantOptions),pagination&query=:relevance:allCategories:${catId}&pageSize=100&lang=zh_TW&curr=TWD&currentPage=0`;
            const firstData = await fetchJSON(firstUrl);
            
            if (firstData.products && firstData.pagination) {
                const totalPages = firstData.pagination.totalPages || 1;
                
                for (let page = 0; page < totalPages; page++) {
                    if (page > 0) console.log(`   -> 抓取 ${catId} 第 ${page + 1}/${totalPages} 頁...`);
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

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n🎉 抓取完成！共收集 ${finalProducts.length} 項商品。`);
}

scrape().catch(err => {
    console.error('致命錯誤:', err);
    process.exit(1);
});
