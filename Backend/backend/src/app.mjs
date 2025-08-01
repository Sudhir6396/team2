// app.mjs - Combined Safety Alert System with Failover Monitoring
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

// Load environment variables
dotenv.config();

// Set required environment variables with defaults
process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
process.env.SNS_ALERT_TOPIC_ARN = process.env.SNS_ALERT_TOPIC_ARN || "arn:aws:sns:ap-south-1:YOUR_ACCOUNT:safety-alerts";

// Mock services (replace with actual imports when services are available)
class FailoverMonitoringService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            healthCheckInterval: 30000,
            alertThreshold: 3,
            services: [],
            metrics: {
                cpu: { threshold: 80 },
                memory: { threshold: 85 },
                disk: { threshold: 90 }
            },
            ...config
        };
        this.isRunning = false;
        this.healthStatus = {
            overall: 'healthy',
            services: [],
            system: {
                cpu: { usage: 45, healthy: true },
                memory: { usage: 62, healthy: true },
                disk: { usage: 35, healthy: true }
            },
            timestamp: new Date().toISOString()
        };
        this.intervalId = null;
    }

    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.emit('monitoring-started');
        
        // Start health check interval
        this.intervalId = setInterval(() => {
            this.performHealthCheck();
        }, this.config.healthCheckInterval);
        
        console.log('✅ Failover monitoring service started');
    }

    async performHealthCheck() {
        try {
            // Simulate health check
            const report = {
                timestamp: new Date().toISOString(),
                overall: 'healthy',
                system: {
                    cpu: { usage: Math.floor(Math.random() * 100), healthy: true },
                    memory: { usage: Math.floor(Math.random() * 100), healthy: true },
                    disk: { usage: Math.floor(Math.random() * 100), healthy: true }
                },
                services: this.config.services.map(service => ({
                    name: service.name,
                    type: service.type,
                    healthy: Math.random() > 0.1, // 90% success rate
                    responseTime: Math.floor(Math.random() * 1000),
                    lastCheck: new Date().toISOString()
                }))
            };

            // Update health status
            this.healthStatus = report;
            
            // Check thresholds
            report.system.cpu.healthy = report.system.cpu.usage < this.config.metrics.cpu.threshold;
            report.system.memory.healthy = report.system.memory.usage < this.config.metrics.memory.threshold;
            report.system.disk.healthy = report.system.disk.usage < this.config.metrics.disk.threshold;

            const systemHealthy = report.system.cpu.healthy && 
                                report.system.memory.healthy && 
                                report.system.disk.healthy;
            const servicesHealthy = report.services.every(s => s.healthy);

            if (systemHealthy && servicesHealthy) {
                this.emit('system-healthy', report);
            } else {
                this.emit('system-unhealthy', report);
            }

            this.emit('health-check-complete', report);
            return report;
        } catch (error) {
            console.error('Health check error:', error);
            throw error;
        }
    }

    getHealthStatus() {
        return this.healthStatus;
    }

    addService(service) {
        this.config.services.push(service);
        console.log(`📊 Added service to monitoring: ${service.name}`);
    }

    removeService(name) {
        this.config.services = this.config.services.filter(s => s.name !== name);
        console.log(`📊 Removed service from monitoring: ${name}`);
    }

    async shutdown() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.isRunning = false;
        console.log('🛑 Failover monitoring service stopped');
    }
}

class AudioIntegrationService {
    constructor() {
        this.isInitialized = false;
        this.activeSessions = new Map();
        this.streamingService = null;
    }

    async initialize() {
        // Simulate initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.isInitialized = true;
        this.streamingService = {
            addConnection: (sessionId, ws) => {
                console.log(`📡 Added WebSocket connection for session: ${sessionId}`);
            },
            removeConnection: (sessionId, ws) => {
                console.log(`📡 Removed WebSocket connection for session: ${sessionId}`);
            },
            streamAudio: async (sessionId, audioData, options = {}) => {
                console.log(`🎵 Streaming audio for session: ${sessionId} from ${options.source || 'unknown'}`);
                return { success: true, sessionId, timestamp: new Date() };
            }
        };
        console.log('🎵 Audio Integration Service initialized');
    }

    async startAudioSession(sessionId, config = {}) {
        const session = {
            id: sessionId,
            config,
            startTime: new Date(),
            status: 'active'
        };
        this.activeSessions.set(sessionId, session);
        console.log(`🎵 Started audio session: ${sessionId}`);
        return session;
    }

    async stopAudioSession(sessionId) {
        if (this.activeSessions.has(sessionId)) {
            this.activeSessions.delete(sessionId);
            console.log(`🎵 Stopped audio session: ${sessionId}`);
        }
    }

    getSessionStatus(sessionId) {
        return this.activeSessions.get(sessionId) || null;
    }

    getActiveSessions() {
        return Array.from(this.activeSessions.values());
    }

    async shutdown() {
        this.activeSessions.clear();
        console.log('🎵 Audio Integration Service stopped');
    }
}

class SmartAudioCache {
    constructor() {
        this.memoryCache = new Map();
        this.diskCache = new Map(); // Simulated disk cache
        this.stats = {
            hits: 0,
            misses: 0,
            totalRequests: 0
        };
    }

    async getAudioWithCache(text, voiceId = 'Joanna', options = {}) {
        const cacheKey = this.generateCacheKey(text, voiceId, options);
        this.stats.totalRequests++;

        // Check memory cache first
        if (this.memoryCache.has(cacheKey)) {
            this.stats.hits++;
            return {
                audioBuffer: this.memoryCache.get(cacheKey),
                fromCache: true,
                source: 'memory'
            };
        }

        // Check disk cache
        if (this.diskCache.has(cacheKey)) {
            this.stats.hits++;
            const audioBuffer = this.diskCache.get(cacheKey);
            // Move to memory cache
            this.memoryCache.set(cacheKey, audioBuffer);
            return {
                audioBuffer,
                fromCache: true,
                source: 'disk'
            };
        }

        // Generate new audio (simulated)
        this.stats.misses++;
        const audioBuffer = await this.generateAudio(text, voiceId, options);
        
        // Cache the result
        this.memoryCache.set(cacheKey, audioBuffer);
        this.diskCache.set(cacheKey, audioBuffer);

        return {
            audioBuffer,
            fromCache: false,
            source: 'generated'
        };
    }

    async generateAudio(text, voiceId, options) {
        // Simulate audio generation delay
        await new Promise(resolve => setTimeout(resolve, 100));
        return Buffer.from(`audio-${text}-${voiceId}-${JSON.stringify(options)}`);
    }

    generateCacheKey(text, voiceId, options) {
        return `${text}-${voiceId}-${JSON.stringify(options)}`;
    }

    getCacheStats() {
        const hitRate = this.stats.totalRequests > 0 
            ? (this.stats.hits / this.stats.totalRequests * 100).toFixed(2)
            : 0;

        return {
            memoryCache: {
                size: this.memoryCache.size,
                entries: this.memoryCache.size
            },
            diskCache: {
                size: this.diskCache.size,
                entries: this.diskCache.size
            },
            stats: {
                ...this.stats,
                hitRate: `${hitRate}%`
            },
            hitRate: parseFloat(hitRate)
        };
    }

    async preCacheCommonAlerts() {
        const commonAlerts = [
            'Emergency alert: Please evacuate the building immediately',
            'Fire alarm activated: Proceed to nearest exit',
            'Security alert: Unauthorized access detected',
            'System maintenance: Services will be temporarily unavailable',
            'Weather alert: Severe weather conditions detected'
        ];

        console.log('🔄 Pre-caching common alerts...');
        for (const alert of commonAlerts) {
            await this.getAudioWithCache(alert, 'Joanna', { engine: 'neural' });
        }
        console.log(`✅ Pre-cached ${commonAlerts.length} common alerts`);
    }
}

class VoiceProcessingPipeline extends EventEmitter {
    constructor() {
        super();
        this.personalities = new Map();
    }

    generateVoice(sessionId, text, personality) {
        const voiceData = {
            sessionId,
            text,
            personality,
            audioData: Buffer.from('simulated-audio-data'),
            timestamp: new Date()
        };
        
        this.emit('voiceGenerated', voiceData);
        return voiceData;
    }

    async setPersonality(sessionId, personality) {
        this.personalities.set(sessionId, personality);
        console.log(`🎭 Setting personality for ${sessionId}: ${personality}`);
        return Promise.resolve();
    }

    getPersonality(sessionId) {
        return {
            sessionId,
            personality: this.personalities.get(sessionId) || 'default'
        };
    }
}

// Factory function for monitoring service
function createMonitoringService(config) {
    return new FailoverMonitoringService(config);
}

// Initialize services
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const audioService = new AudioIntegrationService();
const audioCache = new SmartAudioCache();
const voicePipeline = new VoiceProcessingPipeline();

const PORT = process.env.PORT || 3000;

// Create monitoring service with configuration
const monitoring = createMonitoringService({
    healthCheckInterval: 30000,
    alertThreshold: 3,
    services: [
        {
            name: 'main-api',
            type: 'http',
            url: `http://localhost:${PORT}/health`,
            timeout: 5000
        },
        {
            name: 'external-api',
            type: 'http',
            url: 'https://api.example.com/health',
            timeout: 10000
        },
        {
            name: 'database',
            type: 'tcp',
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 5432,
            timeout: 3000
        },
        {
            name: 'redis-cache',
            type: 'tcp',
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379,
            timeout: 2000
        }
    ],
    metrics: {
        cpu: { threshold: 80 },
        memory: { threshold: 85 },
        disk: { threshold: 90 }
    }
});

// Enhanced audio generation with smart caching
async function generateAudioWithCache(text, voiceId = 'Joanna', options = {}) {
    try {
        const result = await audioCache.getAudioWithCache(text, voiceId, options);
        
        if (result.fromCache) {
            console.log(`✅ Cache hit from ${result.source}: ${text.substring(0, 30)}...`);
        } else {
            console.log(`🆕 Generated new audio: ${text.substring(0, 30)}...`);
        }
        
        return result.audioBuffer;
        
    } catch (error) {
        console.error('❌ Audio generation error:', error);
        throw error;
    }
}

// Set up monitoring event listeners
monitoring.on('monitoring-started', () => {
    console.log('✅ Health monitoring started successfully');
});

monitoring.on('system-healthy', (report) => {
    console.log('✅ System is healthy');
});

monitoring.on('system-unhealthy', (report) => {
    console.warn('⚠️  System health issues detected:', {
        cpu: report.system.cpu.healthy ? '✅' : '❌',
        memory: report.system.memory.healthy ? '✅' : '❌',
        disk: report.system.disk.healthy ? '✅' : '❌',
        services: report.services.filter(s => !s.healthy).map(s => s.name)
    });
});

monitoring.on('alert-sent', ({ severity, subject, messageId }) => {
    console.log(`🚨 ${severity} alert sent: ${subject} (ID: ${messageId})`);
});

monitoring.on('alert-failed', ({ error }) => {
    console.error('❌ Failed to send alert:', error);
});

monitoring.on('health-check-complete', (report) => {
    if (process.env.NODE_ENV === 'development') {
        console.log('Health Check:', {
            timestamp: report.timestamp,
            overall: report.overall,
            cpu: `${report.system.cpu.usage}%`,
            memory: `${report.system.memory.usage}%`,
            services: report.services.map(s => ({ name: s.name, healthy: s.healthy }))
        });
    }
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.raw({ type: 'audio/*' }));

// Root route
app.get('/', (req, res) => {
    res.json({
        name: "Combined Safety Alert System",
        version: "1.0.0",
        status: "running",
        features: {
            failoverMonitoring: "enabled",
            smartCache: "enabled",
            audioGeneration: "enhanced",
            websocket: "active"
        },
        monitoring: monitoring.getHealthStatus(),
        endpoints: {
            health: "/health",
            monitoringStatus: "/monitoring/status",
            sessions: "/api/audio/sessions",
            startSession: "POST /api/audio/session/start",
            stopSession: "POST /api/audio/session/stop",
            sessionStatus: "GET /api/audio/session/:sessionId/status",
            uploadAudio: "POST /api/audio/upload/:sessionId",
            textToSpeech: "POST /api/text-to-speech",
            cacheStats: "GET /api/cache-stats",
            preCache: "POST /api/precache",
            bulkCache: "POST /api/bulk-cache"
        },
        websocket: `ws://localhost:${PORT}`
    });
});

// Enhanced health endpoint
app.get('/health', (req, res) => {
    try {
        const cacheStats = audioCache.getCacheStats();
        const monitoringStatus = monitoring.getHealthStatus();
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.env.npm_package_version || '1.0.0',
            services: {
                audioIntegration: audioService.isInitialized ? 'ready' : 'initializing',
                smartCache: 'active',
                failoverMonitoring: monitoring.isRunning ? 'active' : 'inactive',
                websocket: 'active'
            },
            cache: {
                memorySize: cacheStats.memoryCache.size,
                diskSize: cacheStats.diskCache.size,
                hitRate: cacheStats.hitRate
            },
            monitoring: monitoringStatus
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Monitoring endpoints
app.get('/monitoring/status', (req, res) => {
    res.json(monitoring.getHealthStatus());
});

app.post('/monitoring/check', async (req, res) => {
    try {
        const report = await monitoring.performHealthCheck();
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/monitoring/services', (req, res) => {
    const { name, type, ...config } = req.body;
    
    if (!name || !type) {
        return res.status(400).json({ error: 'Name and type are required' });
    }

    monitoring.addService({ name, type, ...config });
    res.json({ message: `Service ${name} added to monitoring` });
});

app.delete('/monitoring/services/:name', (req, res) => {
    const { name } = req.params;
    monitoring.removeService(name);
    res.json({ message: `Service ${name} removed from monitoring` });
});

// Audio endpoints
app.post('/api/text-to-speech', async (req, res) => {
    try {
        const { text, voiceId = 'Joanna', engine = 'neural' } = req.body;
        
        if (!text) {
            return res.status(400).json({
                success: false,
                error: 'Text is required'
            });
        }
        
        const result = await audioCache.getAudioWithCache(text, voiceId, { engine });
        
        res.json({
            success: true,
            audioData: result.audioBuffer.toString('base64'),
            text: text,
            voiceId: voiceId,
            engine: engine,
            fromCache: result.fromCache,
            cacheSource: result.source,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/cache-stats', (req, res) => {
    try {
        const stats = audioCache.getCacheStats();
        res.json({
            success: true,
            ...stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/precache', async (req, res) => {
    try {
        await audioCache.preCacheCommonAlerts();
        res.json({
            success: true,
            message: 'Common alerts pre-cached successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/bulk-cache', async (req, res) => {
    try {
        const { texts, voiceId = 'Joanna' } = req.body;
        
        if (!Array.isArray(texts)) {
            return res.status(400).json({
                success: false,
                error: 'texts must be an array'
            });
        }
        
        const results = [];
        for (const text of texts) {
            try {
                const result = await audioCache.getAudioWithCache(text, voiceId);
                results.push({
                    text,
                    success: true,
                    fromCache: result.fromCache,
                    source: result.source
                });
            } catch (error) {
                results.push({
                    text,
                    success: false,
                    error: error.message
                });
            }
        }
        
        res.json({
            success: true,
            results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/audio/session/start', async (req, res) => {
    const { sessionId, config } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

    try {
        const session = await audioService.startAudioSession(sessionId, config);
        res.json({ success: true, sessionId, config: session });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/audio/session/stop', async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

    try {
        await audioService.stopAudioSession(sessionId);
        res.json({ success: true, sessionId });
    } catch (error) {
        console.error('Error stopping session:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/audio/session/:sessionId/status', (req, res) => {
    try {
        const status = audioService.getSessionStatus(req.params.sessionId);
        if (!status) return res.status(404).json({ error: 'Session not found' });
        res.json(status);
    } catch (error) {
        console.error('Error getting session status:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/audio/sessions', (req, res) => {
    try {
        res.json({ 
            sessions: audioService.getActiveSessions(),
            count: audioService.getActiveSessions().length,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/audio/upload/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const audioData = req.body;
    if (!audioData) return res.status(400).json({ error: 'No audio data provided' });

    try {
        const result = await audioService.streamingService.streamAudio(sessionId, audioData, {
            source: 'http-upload'
        });
        res.json({ success: true, result });
    } catch (error) {
        console.error('Error uploading audio:', error);
        res.status(500).json({ error: error.message });
    }
});

// WebSocket handling
wss.on('connection', ws => {
    let sessionId = null;
    console.log('🔌 New WebSocket connection');

    ws.on('message', async message => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'join_session':
                    sessionId = data.sessionId;
                    audioService.streamingService.addConnection(sessionId, ws);
                    ws.send(JSON.stringify({ type: 'session_joined', sessionId }));
                    console.log(`📡 WebSocket joined session: ${sessionId}`);
                    break;

                case 'audio_chunk':
                    if (sessionId) {
                        await audioService.streamingService.streamAudio(sessionId, data.audioData, {
                            source: 'websocket'
                        });
                    }
                    break;

                case 'generate_alert':
                    console.log('🚨 Generating alert with cache...');
                    const audioBuffer = await generateAudioWithCache(
                        data.text,
                        data.voiceId || 'Joanna'
                    );
                    ws.send(JSON.stringify({
                        type: 'alert_generated',
                        audioData: audioBuffer.toString('base64'),
                        text: data.text,
                        timestamp: new Date().toISOString()
                    }));
                    break;

                case 'text_to_speech':
                    console.log('🗣️ Text to speech with cache...');
                    const ttsAudio = await generateAudioWithCache(
                        data.text,
                        data.voiceId || 'Joanna',
                        { engine: data.engine || 'neural' }
                    );
                    ws.send(JSON.stringify({
                        type: 'audio_generated',
                        audioData: ttsAudio.toString('base64'),
                        text: data.text,
                        timestamp: new Date().toISOString()
                    }));
                    break;

                case 'cache_stats':
                    console.log('📊 Getting cache statistics...');
                    const stats = audioCache.getCacheStats();
                    ws.send(JSON.stringify({
                        type: 'cache_stats',
                        ...stats,
                        timestamp: new Date().toISOString()
                    }));
                    break;

                case 'precache_alerts':
                    console.log('🔄 Pre-caching common alerts...');
                    await audioCache.preCacheCommonAlerts();
                    ws.send(JSON.stringify({
                        type: 'precache_completed',
                        message: 'Common alerts pre-cached successfully',
                        timestamp: new Date().toISOString()
                    }));
                    break;

                case 'monitoring_status':
                    const monitoringStatus = monitoring.getHealthStatus();
                    ws.send(JSON.stringify({
                        type: 'monitoring_status',
                        ...monitoringStatus,
                        timestamp: new Date().toISOString()
                    }));
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', timestamp: new Date() }));
                    break;

                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: `Unknown message type: ${data.type}`,
                        timestamp: new Date().toISOString()
                    }));
            }

        } catch (error) {
            console.error('❌ WebSocket message processing error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            }));
        }
    });

    ws.on('close', () => {
        console.log('🔌 WebSocket disconnected');
        if (sessionId) {
            audioService.streamingService.removeConnection(sessionId, ws);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Express error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
    });
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    try {
        // Stop the monitoring service
        await monitoring.shutdown();
        
        // Stop audio service
        await audioService.shutdown();
        
        // Close WebSocket server
        wss.close();
        
        // Close the Express server
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });

        // Force shutdown after 10 seconds
        setTimeout(() => {
            console.log('Force shutdown');
            process.exit(1);
        }, 10000);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
});

// Server startup
async function startServer() {
    try {
        console.log('🚀 Initializing Combined Safety Alert System...');
        
        // Initialize audio service
        await audioService.initialize();
        
        // Start monitoring service
        monitoring.start();
        
        // Pre-cache common alerts
        console.log('🔄 Pre-caching common alerts...');
        await audioCache.preCacheCommonAlerts();
        
        // Start server
        server.listen(PORT, () => {
            console.log(`🚀 Combined Safety Alert System started successfully!`);
            console.log(`📡 REST API: http://localhost:${PORT}`);
            console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
            console.log(`❤️  Health check: http://localhost:${PORT}/health`);
            console.log(`📊 Monitoring: http://localhost:${PORT}/monitoring/status`);
            console.log(`🧠 Smart Audio Cache: ACTIVE`);   
            console.log(`🔔 SNS alerts configured: ${process.env.SNS_ALERT_TOPIC_ARN}`);
            console.log(`🎵 Audio Integration: READY`);
            console.log(`⚡ Failover Monitoring: ACTIVE`);
        });

    } catch (error) {
        console.error('❌ Error starting server:', error);
        process.exit(1);
    }
}

// Start the combined application
startServer();

// Export for testing
export default app;
export { 
    monitoring, 
    audioService, 
    audioCache, 
    voicePipeline,
    createMonitoringService,
    FailoverMonitoringService,
    AudioIntegrationService,
    SmartAudioCache,
    VoiceProcessingPipeline
};