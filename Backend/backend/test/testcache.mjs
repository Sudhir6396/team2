import { SmartAudioCache } from '../src/services/smartAudioCache.mjs';

async function testCachePerformance() {
    console.log('🧪 Testing Smart Audio Cache Performance...\n');
    
    const cache = new SmartAudioCache();
    
    const testTexts = [
        "Emergency alert activated",
        "Weather warning issued", 
        "Traffic alert in your area",
        "System maintenance notification"
    ];
    
    console.log('📊 Performance Test Results:');
    console.log('================================');
    
    for (const text of testTexts) {
        // First call - should be cache miss
        console.log(`\n🔍 Testing: "${text}"`);
        
        const start1 = Date.now();
        const result1 = await cache.getAudioWithCache(text, 'Joanna');
        const time1 = Date.now() - start1;
        
        console.log(`   First call:  ${time1}ms (${result1.source}) - ${result1.fromCache ? 'HIT' : 'MISS'}`);
        
        // Second call - should be memory cache hit
        const start2 = Date.now();
        const result2 = await cache.getAudioWithCache(text, 'Joanna');
        const time2 = Date.now() - start2;
        
        console.log(`   Second call: ${time2}ms (${result2.source}) - ${result2.fromCache ? 'HIT' : 'MISS'}`);
        console.log(`   Speedup: ${(time1 / time2).toFixed(2)}x faster`);
    }
    
    // Show cache stats
    console.log('\n📈 Cache Statistics:');
    console.log('====================');
    const stats = cache.getCacheStats();
    console.log(JSON.stringify(stats, null, 2));
    
    process.exit(0);
}

testCachePerformance();