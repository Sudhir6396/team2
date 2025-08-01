// test-services.mjs - Testing the Combined Safety Alert System Services
import { 
    FailoverMonitoringService, 
    AudioIntegrationService, 
    SmartAudioCache, 
    VoiceProcessingPipeline 
} from './app.mjs';

// Alternative: Import the running instances if app is already running
// import { monitoring, audioService, audioCache, voicePipeline } from './app.mjs';

// Test Configuration
const TEST_CONFIG = {
    testAudioTexts: [
        "Emergency alert: Please evacuate the building immediately",
        "Fire alarm activated: Proceed to nearest exit",
        "Security alert: Unauthorized access detected",
        "System maintenance in progress",
        "All clear: Normal operations resumed"
    ],
    voiceIds: ['Joanna', 'Matthew', 'Amy'],
    sessionIds: ['test-session-1', 'test-session-2', 'test-session-3']
};

// 1. Test Voice Command Processing (equivalent to VoiceCommandProcessor)
async function testVoiceProcessing() {
    console.log('\n🎤 Testing Voice Processing Pipeline...');
    
    const processor = new VoiceProcessingPipeline();
    
    // Test setting personalities
    for (const sessionId of TEST_CONFIG.sessionIds) {
        await processor.setPersonality(sessionId, `personality-${sessionId}`);
        const personality = processor.getPersonality(sessionId);
        console.log(`✅ Session ${sessionId}:`, personality);
    }
    
    // Test voice generation
    processor.on('voiceGenerated', (voiceData) => {
        console.log('🎵 Voice generated:', {
            sessionId: voiceData.sessionId,
            text: voiceData.text.substring(0, 50) + '...',
            personality: voiceData.personality,
            timestamp: voiceData.timestamp
        });
    });
    
    // Generate test voices
    for (let i = 0; i < 3; i++) {
        const sessionId = TEST_CONFIG.sessionIds[i];
        const text = TEST_CONFIG.testAudioTexts[i];
        processor.generateVoice(sessionId, text, `personality-${i + 1}`);
    }
    
    return processor;
}

// 2. Test Audio Caching (equivalent to AudioCachingService)
async function testAudioCaching() {
    console.log('\n🧠 Testing Smart Audio Cache...');
    
    const cache = new SmartAudioCache();
    
    // Pre-cache common alerts
    console.log('🔄 Pre-caching common alerts...');
    await cache.preCacheCommonAlerts();
    
    // Test cache performance with different texts
    console.log('🔍 Testing cache performance...');
    for (const text of TEST_CONFIG.testAudioTexts) {
        for (const voiceId of TEST_CONFIG.voiceIds.slice(0, 2)) {
            // First call - should miss cache
            const result1 = await cache.getAudioWithCache(text, voiceId);
            console.log(`${result1.fromCache ? '✅ HIT' : '❌ MISS'} (${result1.source}): ${text.substring(0, 30)}... [${voiceId}]`);
            
            // Second call - should hit cache
            const result2 = await cache.getAudioWithCache(text, voiceId);
            console.log(`${result2.fromCache ? '✅ HIT' : '❌ MISS'} (${result2.source}): ${text.substring(0, 30)}... [${voiceId}]`);
        }
    }
    
    // Display cache statistics
    const stats = cache.getCacheStats();
    console.log('📊 Cache Statistics:', {
        memoryEntries: stats.memoryCache.size,
        diskEntries: stats.diskCache.size,
        hitRate: stats.hitRate,
        totalRequests: stats.stats.totalRequests,
        hits: stats.stats.hits,
        misses: stats.stats.misses
    });
    
    return cache;
}

// 3. Test Failover Monitoring (equivalent to FailoverMonitoringService)
async function testFailoverMonitoring() {
    console.log('\n⚡ Testing Failover Monitoring Service...');
    
    const monitor = new FailoverMonitoringService({
        healthCheckInterval: 5000, // 5 seconds for testing
        alertThreshold: 2,
        services: [
            {
                name: 'test-api',
                type: 'http',
                url: 'http://localhost:3000/health',
                timeout: 3000
            },
            {
                name: 'test-db',
                type: 'tcp',
                host: 'localhost',
                port: 5432,
                timeout: 2000
            }
        ],
        metrics: {
            cpu: { threshold: 75 },
            memory: { threshold: 80 },
            disk: { threshold: 85 }
        }
    });
    
    // Set up event listeners
    monitor.on('monitoring-started', () => {
        console.log('✅ Monitoring started');
    });
    
    monitor.on('system-healthy', (report) => {
        console.log('💚 System is healthy');
    });
    
    monitor.on('system-unhealthy', (report) => {
        console.log('🔴 System health issues:', {
            cpu: report.system.cpu.healthy ? '✅' : `❌ ${report.system.cpu.usage}%`,
            memory: report.system.memory.healthy ? '✅' : `❌ ${report.system.memory.usage}%`,
            disk: report.system.disk.healthy ? '✅' : `❌ ${report.system.disk.usage}%`,
            unhealthyServices: report.services.filter(s => !s.healthy).map(s => s.name)
        });
    });
    
    monitor.on('health-check-complete', (report) => {
        console.log('📋 Health check completed:', {
            overall: report.overall,
            timestamp: report.timestamp,
            systemCPU: `${report.system.cpu.usage}%`,
            systemMemory: `${report.system.memory.usage}%`,
            serviceCount: report.services.length
        });
    });
    
    // Start monitoring
    monitor.start();
    
    // Get initial status
    const status = monitor.getHealthStatus();
    console.log('📊 Initial System Status:', {
        overall: status.overall,
        cpu: `${status.system.cpu.usage}% (${status.system.cpu.healthy ? 'healthy' : 'unhealthy'})`,
        memory: `${status.system.memory.usage}% (${status.system.memory.healthy ? 'healthy' : 'unhealthy'})`,
        disk: `${status.system.disk.usage}% (${status.system.disk.healthy ? 'healthy' : 'unhealthy'})`,
        services: status.services.length,
        timestamp: status.timestamp
    });
    
    // Perform manual health check
    console.log('🔍 Performing manual health check...');
    const manualCheck = await monitor.performHealthCheck();
    console.log('📋 Manual check result:', {
        overall: manualCheck.overall,
        servicesHealthy: manualCheck.services.filter(s => s.healthy).length,
        servicesTotal: manualCheck.services.length
    });
    
    // Test adding/removing services
    console.log('🔧 Testing service management...');
    monitor.addService({
        name: 'dynamic-service',
        type: 'http',
        url: 'http://example.com/health',
        timeout: 5000
    });
    
    monitor.removeService('dynamic-service');
    
    return monitor;
}

// 4. Test Audio Integration Service
async function testAudioIntegration() {
    console.log('\n🎵 Testing Audio Integration Service...');
    
    const audioService = new AudioIntegrationService();
    await audioService.initialize();
    
    // Test session management
    const sessionId = 'integration-test-session';
    const sessionConfig = {
        quality: 'high',
        format: 'mp3',
        sampleRate: 44100
    };
    
    console.log('🎬 Starting audio session...');
    const session = await audioService.startAudioSession(sessionId, sessionConfig);
    console.log('✅ Session started:', session);
    
    // Test session status
    const status = audioService.getSessionStatus(sessionId);
    console.log('📊 Session status:', status);
    
    // Test active sessions
    const activeSessions = audioService.getActiveSessions();
    console.log('📋 Active sessions:', activeSessions.length);
    
    // Test streaming (simulated)
    if (audioService.streamingService) {
        console.log('🎵 Testing audio streaming...');
        const streamResult = await audioService.streamingService.streamAudio(
            sessionId, 
            Buffer.from('test-audio-data'), 
            { source: 'test' }
        );
        console.log('✅ Stream result:', streamResult);
    }
    
    // Stop session
    console.log('🛑 Stopping audio session...');
    await audioService.stopAudioSession(sessionId);
    console.log('✅ Session stopped');
    
    return audioService;
}

// 5. Comprehensive Integration Test
async function runIntegrationTest() {
    console.log('\n🧪 Running Comprehensive Integration Test...');
    
    try {
        // Test all services
        const voiceProcessor = await testVoiceProcessing();
        const audioCache = await testAudioCaching();
        const monitoring = await testFailoverMonitoring();
        const audioService = await testAudioIntegration();
        
        console.log('\n✅ All services tested successfully!');
        
        // Test inter-service communication
        console.log('\n🔗 Testing inter-service communication...');
        
        // Generate voice with caching
        const testText = "Integration test: All systems operational";
        const cachedAudio = await audioCache.getAudioWithCache(testText, 'Joanna');
        console.log('✅ Voice generated with caching:', {
            fromCache: cachedAudio.fromCache,
            source: cachedAudio.source
        });
        
        // Generate voice event
        voiceProcessor.generateVoice('integration-test', testText, 'test-personality');
        
        // Check monitoring status
        const systemStatus = monitoring.getHealthStatus();
        console.log('✅ System monitoring active:', systemStatus.overall);
        
        // Stop monitoring for cleanup
        await monitoring.shutdown();
        await audioService.shutdown();
        
        console.log('\n🎉 Integration test completed successfully!');
        
    } catch (error) {
        console.error('❌ Integration test failed:', error);
    }
}

// 6. HTTP API Testing (when server is running)
async function testHttpAPI() {
    console.log('\n🌐 Testing HTTP API endpoints...');
    
    const baseUrl = 'http://localhost:3000';
    
    try {
        // Test health endpoint
        console.log('🔍 Testing health endpoint...');
        const healthResponse = await fetch(`${baseUrl}/health`);
        const healthData = await healthResponse.json();
        console.log('✅ Health check:', healthData.status);
        
        // Test text-to-speech
        console.log('🗣️ Testing text-to-speech...');
        const ttsResponse = await fetch(`${baseUrl}/api/text-to-speech`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: 'HTTP API test message',
                voiceId: 'Joanna',
                engine: 'neural'
            })
        });
        const ttsData = await ttsResponse.json();
        console.log('✅ TTS response:', {
            success: ttsData.success,
            fromCache: ttsData.fromCache,
            cacheSource: ttsData.cacheSource
        });
        
        // Test cache stats
        console.log('📊 Testing cache stats...');
        const cacheResponse = await fetch(`${baseUrl}/api/cache-stats`);
        const cacheData = await cacheResponse.json();
        console.log('✅ Cache stats:', {
            memoryEntries: cacheData.memoryCache.size,
            hitRate: cacheData.hitRate
        });
        
        // Test monitoring status
        console.log('⚡ Testing monitoring status...');
        const monitorResponse = await fetch(`${baseUrl}/monitoring/status`);
        const monitorData = await monitorResponse.json();
        console.log('✅ Monitoring status:', monitorData.overall);
        
    } catch (error) {
        console.error('❌ HTTP API test failed:', error);
        console.log('💡 Make sure the server is running: node app.mjs');
    }
}

// 7. WebSocket Testing
function testWebSocket() {
    console.log('\n🔌 Testing WebSocket connection...');
    
    // Note: This requires 'ws' package and server to be running
    try {
        const WebSocket = require('ws');
        const ws = new WebSocket('ws://localhost:3000');
        
        ws.on('open', () => {
            console.log('✅ WebSocket connected');
            
            // Test ping
            ws.send(JSON.stringify({ type: 'ping' }));
            
            // Test cache stats via WebSocket
            ws.send(JSON.stringify({ type: 'cache_stats' }));
            
            // Test alert generation
            ws.send(JSON.stringify({
                type: 'generate_alert',
                text: 'WebSocket test alert',
                voiceId: 'Joanna'
            }));
        });
        
        ws.on('message', (data) => {
            const message = JSON.parse(data);
            console.log('📨 WebSocket message:', message.type);
        });
        
        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
        });
        
        // Close after 5 seconds
        setTimeout(() => {
            ws.close();
            console.log('🔌 WebSocket connection closed');
        }, 5000);
        
    } catch (error) {
        console.error('❌ WebSocket test failed:', error.message);
        console.log('💡 Install ws package: npm install ws');
    }
}

// Main test runner
async function runAllTests() {
    console.log('🚀 Starting All Service Tests...\n');
    
    // Run individual service tests
    await testVoiceProcessing();
    await testAudioCaching();
    await testFailoverMonitoring();
    await testAudioIntegration();
    
    // Wait a bit for monitoring to run
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Run integration test
    await runIntegrationTest();
    
    // Test HTTP API (if server is running)
    await testHttpAPI();
    
    // Test WebSocket (if server is running and ws is available)
    // testWebSocket();
    
    console.log('\n🎉 All tests completed!');
}

// Export test functions
export {
    testVoiceProcessing,
    testAudioCaching,
    testFailoverMonitoring,
    testAudioIntegration,
    runIntegrationTest,
    testHttpAPI,
    testWebSocket,
    runAllTests
};

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests().catch(console.error);
}