

import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class SmartAudioCache {
    constructor() {
        this.pollyClient = new PollyClient({ region: "ap-south-1" });
        this.s3Client = new S3Client({ region: "ap-south-1" });
        
        // Multi-level caching strategy
        this.memoryCache = new Map();           // Level 1: Memory (fastest)
        this.diskCache = new Map();             // Level 2: Local disk (fast)
        this.s3Cache = true;                    // Level 3: S3 (network)
        
        // Cache settings
        this.maxMemoryCache = 50;               // Max items in memory
        this.maxDiskCache = 200;                // Max items on disk
        this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
        this.diskCachePath = './cache/audio/';  // Local cache directory
        
        // Stats tracking
        this.stats = {
            memoryHits: 0,
            diskHits: 0,
            s3Hits: 0,
            misses: 0,
            totalRequests: 0
        };
        
        this.initializeCache();
    }

    // Initialize cache directories and cleanup
    async initializeCache() {
        try {
            // Create disk cache directory
            if (!fs.existsSync(this.diskCachePath)) {
                fs.mkdirSync(this.diskCachePath, { recursive: true });
            }
            
            // Load existing disk cache index
            await this.loadDiskCacheIndex();
            
            // Cleanup expired entries
            this.startCleanupTimer();
            
            console.log('✅ SmartAudioCache initialized');
        } catch (error) {
            console.error('❌ Cache initialization error:', error);
        }
    }

    // Generate unique cache key
    generateCacheKey(text, voiceId, options = {}) {
        const data = JSON.stringify({
            text: text.trim().toLowerCase(),
            voiceId,
            engine: options.engine || 'neural',
            format: options.format || 'mp3'
        });
        return crypto.createHash('md5').update(data).digest('hex');
    }

    // **MAIN FUNCTION: Get cached audio or generate new**
    async getAudioWithCache(text, voiceId = 'Joanna', options = {}) {
        this.stats.totalRequests++;
        const cacheKey = this.generateCacheKey(text, voiceId, options);
        
        try {
            // Level 1: Check memory cache (fastest)
            const memoryResult = this.checkMemoryCache(cacheKey);
            if (memoryResult) {
                this.stats.memoryHits++;
                console.log(`🧠 Memory cache hit: ${text.substring(0, 30)}...`);
                return {
                    audioBuffer: memoryResult,
                    source: 'memory',
                    cacheKey,
                    fromCache: true
                };
            }

            // Level 2: Check disk cache (fast)
            const diskResult = await this.checkDiskCache(cacheKey);
            if (diskResult) {
                this.stats.diskHits++;
                console.log(`💾 Disk cache hit: ${text.substring(0, 30)}...`);
                
                // Store in memory for next time
                this.storeInMemoryCache(cacheKey, diskResult);
                
                return {
                    audioBuffer: diskResult,
                    source: 'disk',
                    cacheKey,
                    fromCache: true
                };
            }

            // Level 3: Check S3 cache (network)
            if (this.s3Cache) {
                const s3Result = await this.checkS3Cache(cacheKey);
                if (s3Result) {
                    this.stats.s3Hits++;
                    console.log(`☁️ S3 cache hit: ${text.substring(0, 30)}...`);
                    
                    // Store in memory and disk for next time
                    this.storeInMemoryCache(cacheKey, s3Result);
                    await this.storeToDiskCache(cacheKey, s3Result);
                    
                    return {
                        audioBuffer: s3Result,
                        source: 's3',
                        cacheKey,
                        fromCache: true
                    };
                }
            }

            // Cache miss - generate new audio
            this.stats.misses++;
            console.log(`🎵 Generating new audio: ${text.substring(0, 30)}...`);
            
            const audioBuffer = await this.generatePollyAudio(text, voiceId, options);
            
            // Store in all cache levels
            await this.storeInAllCaches(cacheKey, audioBuffer);
            
            return {
                audioBuffer,
                source: 'generated',
                cacheKey,
                fromCache: false
            };
            
        } catch (error) {
            console.error('❌ Audio caching error:', error);
            throw error;
        }
    }

    // Generate audio using Polly
    async generatePollyAudio(text, voiceId, options = {}) {
        try {
            const params = {
                Text: text,
                VoiceId: voiceId,
                OutputFormat: options.format || 'mp3',
                Engine: options.engine || 'neural'
            };

            const command = new SynthesizeSpeechCommand(params);
            const response = await this.pollyClient.send(command);
            
            // Convert stream to buffer
            const chunks = [];
            for await (const chunk of response.AudioStream) {
                chunks.push(chunk);
            }
            
            return Buffer.concat(chunks);
            
        } catch (error) {
            console.error('❌ Polly generation error:', error);
            throw error;
        }
    }

    // Memory cache operations
    checkMemoryCache(cacheKey) {
        const cached = this.memoryCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        
        if (cached) {
            this.memoryCache.delete(cacheKey);
        }
        return null;
    }

    storeInMemoryCache(cacheKey, audioBuffer) {
        // LRU eviction
        if (this.memoryCache.size >= this.maxMemoryCache) {
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
        }

        this.memoryCache.set(cacheKey, {
            data: audioBuffer,
            timestamp: Date.now()
        });
    }

    // Disk cache operations
    async checkDiskCache(cacheKey) {
        try {
            const filePath = path.join(this.diskCachePath, `${cacheKey}.mp3`);
            const metaPath = path.join(this.diskCachePath, `${cacheKey}.meta`);
            
            // Check if files exist
            if (!fs.existsSync(filePath) || !fs.existsSync(metaPath)) {
                return null;
            }
            
            // Check if expired
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (Date.now() - meta.timestamp > this.cacheExpiry) {
                fs.unlinkSync(filePath);
                fs.unlinkSync(metaPath);
                return null;
            }
            
            return fs.readFileSync(filePath);
            
        } catch (error) {
            console.error('❌ Disk cache read error:', error);
            return null;
        }
    }

    async storeToDiskCache(cacheKey, audioBuffer) {
        try {
            // LRU eviction for disk cache
            if (this.diskCache.size >= this.maxDiskCache) {
                const oldestKey = this.diskCache.keys().next().value;
                await this.removeDiskCacheEntry(oldestKey);
            }

            const filePath = path.join(this.diskCachePath, `${cacheKey}.mp3`);
            const metaPath = path.join(this.diskCachePath, `${cacheKey}.meta`);
            
            // Write audio file
            fs.writeFileSync(filePath, audioBuffer);
            
            // Write metadata
            const meta = {
                timestamp: Date.now(),
                size: audioBuffer.length,
                cacheKey
            };
            fs.writeFileSync(metaPath, JSON.stringify(meta));
            
            this.diskCache.set(cacheKey, Date.now());
            
        } catch (error) {
            console.error('❌ Disk cache write error:', error);
        }
    }

    // S3 cache operations
    async checkS3Cache(cacheKey) {
        try {
            const bucketName = process.env.AUDIO_CACHE_BUCKET || 'safety-alert-audio-cache';
            const key = `audio-cache/${cacheKey}.mp3`;
            
            // Check if object exists and is not expired
            const headParams = { Bucket: bucketName, Key: key };
            const headResponse = await this.s3Client.send(new HeadObjectCommand(headParams));
            
            const age = Date.now() - new Date(headResponse.LastModified).getTime();
            if (age > this.cacheExpiry) {
                return null;
            }
            
            // Get the audio data
            const getParams = { Bucket: bucketName, Key: key };
            const response = await this.s3Client.send(new GetObjectCommand(getParams));
            
            const chunks = [];
            for await (const chunk of response.Body) {
                chunks.push(chunk);
            }
            
            return Buffer.concat(chunks);
            
        } catch (error) {
            if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
                return null;
            }
            console.error('❌ S3 cache error:', error);
            return null;
        }
    }

    async storeToS3Cache(cacheKey, audioBuffer) {
        try {
            const bucketName = process.env.AUDIO_CACHE_BUCKET || 'safety-alert-audio-cache';
            const key = `audio-cache/${cacheKey}.mp3`;
            
            const params = {
                Bucket: bucketName,
                Key: key,
                Body: audioBuffer,
                ContentType: 'audio/mpeg',
                CacheControl: 'max-age=86400',
                Metadata: {
                    cachedAt: new Date().toISOString(),
                    cacheKey
                }
            };
            
            await this.s3Client.send(new PutObjectCommand(params));
            
        } catch (error) {
            console.error('❌ S3 cache store error:', error);
        }
    }

    // Store in all cache levels
    async storeInAllCaches(cacheKey, audioBuffer) {
        // Store in memory
        this.storeInMemoryCache(cacheKey, audioBuffer);
        
        // Store on disk
        await this.storeToDiskCache(cacheKey, audioBuffer);
        
        // Store in S3 (async, don't wait)
        if (this.s3Cache) {
            this.storeToS3Cache(cacheKey, audioBuffer).catch(err => {
                console.error('S3 cache store failed:', err);
            });
        }
    }

    // Utility functions
    async loadDiskCacheIndex() {
        try {
            if (!fs.existsSync(this.diskCachePath)) return;
            
            const files = fs.readdirSync(this.diskCachePath);
            for (const file of files) {
                if (file.endsWith('.meta')) {
                    const cacheKey = file.replace('.meta', '');
                    const metaPath = path.join(this.diskCachePath, file);
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                    this.diskCache.set(cacheKey, meta.timestamp);
                }
            }
            
            console.log(`📚 Loaded ${this.diskCache.size} disk cache entries`);
        } catch (error) {
            console.error('❌ Error loading disk cache index:', error);
        }
    }

    removeDiskCacheEntry(cacheKey) {
        try {
            const filePath = path.join(this.diskCachePath, `${cacheKey}.mp3`);
            const metaPath = path.join(this.diskCachePath, `${cacheKey}.meta`);
            
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
            
            this.diskCache.delete(cacheKey);
        } catch (error) {
            console.error('❌ Error removing disk cache entry:', error);
        }
    }

    startCleanupTimer() {
        // Cleanup expired entries every hour
        setInterval(() => {
            this.cleanupExpiredEntries();
        }, 60 * 60 * 1000);
    }

    cleanupExpiredEntries() {
        const now = Date.now();
        
        // Cleanup memory cache
        for (const [key, value] of this.memoryCache.entries()) {
            if (now - value.timestamp > this.cacheExpiry) {
                this.memoryCache.delete(key);
            }
        }
        
        // Cleanup disk cache
        for (const [key, timestamp] of this.diskCache.entries()) {
            if (now - timestamp > this.cacheExpiry) {
                this.removeDiskCacheEntry(key);
            }
        }
        
        console.log('🧹 Cache cleanup completed');
    }

    // Pre-cache common alerts
    async preCacheCommonAlerts() {
        const commonAlerts = [
            "Emergency alert activated",
            "Weather warning issued",
            "Traffic alert in your area", 
            "System maintenance notification",
            "Alert acknowledged",
            "Emergency services contacted"
        ];
        
        const voices = ['Joanna', 'Matthew', 'Amy'];
        
        console.log('🔄 Pre-caching common alerts...');
        
        for (const alert of commonAlerts) {
            for (const voice of voices) {
                try {
                    await this.getAudioWithCache(alert, voice);
                } catch (error) {
                    console.error(`❌ Pre-cache failed for "${alert}" with ${voice}:`, error);
                }
            }
        }
        
        console.log('✅ Pre-caching completed');
    }

    // Get cache statistics
    getCacheStats() {
        const hitRate = this.stats.totalRequests > 0 
            ? ((this.stats.memoryHits + this.stats.diskHits + this.stats.s3Hits) / this.stats.totalRequests * 100).toFixed(2)
            : '0.00';
            
        return {
            stats: this.stats,
            hitRate: `${hitRate}%`,
            cacheSize: {
                memory: this.memoryCache.size,
                disk: this.diskCache.size,
                maxMemory: this.maxMemoryCache,
                maxDisk: this.maxDiskCache
            },
            performance: {
                memoryHitRate: `${(this.stats.memoryHits / Math.max(this.stats.totalRequests, 1) * 100).toFixed(2)}%`,
                diskHitRate: `${(this.stats.diskHits / Math.max(this.stats.totalRequests, 1) * 100).toFixed(2)}%`,
                s3HitRate: `${(this.stats.s3Hits / Math.max(this.stats.totalRequests, 1) * 100).toFixed(2)}%`
            }
        };
    }
}