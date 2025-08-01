import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import crypto from 'crypto';
import { Readable } from 'stream';

export class AudioCachingService {
    constructor() {
        this.s3Client = new S3Client({ region: "ap-south-1" });
        this.cloudFrontClient = new CloudFrontClient({ region: "ap-south-1" });
        this.bucketName = process.env.AUDIO_CACHE_BUCKET || "safety-alert-audio-cache";
        this.cloudFrontDistributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
        this.memoryCache = new Map();
        this.maxMemoryCacheSize = 50; // Maximum items in memory cache
        this.cacheExpiryTime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    }

    // Generate cache key from audio parameters
    generateCacheKey(text, voiceId, outputFormat = "mp3", engine = "neural") {
        const data = `${text}-${voiceId}-${outputFormat}-${engine}`;
        return crypto.createHash('md5').update(data).digest('hex');
    }

    // Check if audio exists in memory cache
    getFromMemoryCache(cacheKey) {
        const cached = this.memoryCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiryTime) {
            console.log(`Memory cache hit for: ${cacheKey}`);
            return cached.data;
        }
        
        // Remove expired cache
        if (cached) {
            this.memoryCache.delete(cacheKey);
        }
        return null;
    }

    // Store audio in memory cache
    storeInMemoryCache(cacheKey, audioData) {
        // Implement LRU eviction if cache is full
        if (this.memoryCache.size >= this.maxMemoryCacheSize) {
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
        }

        this.memoryCache.set(cacheKey, {
            data: audioData,
            timestamp: Date.now()
        });
        console.log(`Stored in memory cache: ${cacheKey}`);
    }

    // Check if audio exists in S3 cache
    async getFromS3Cache(cacheKey) {
        try {
            const params = {
                Bucket: this.bucketName,
                Key: `audio-cache/${cacheKey}.mp3`
            };

            // Check if object exists and get metadata
            const headCommand = new HeadObjectCommand(params);
            const headResponse = await this.s3Client.send(headCommand);
            
            // Check if cache is still valid
            const lastModified = new Date(headResponse.LastModified);
            const now = new Date();
            const ageInMs = now - lastModified;
            
            if (ageInMs > this.cacheExpiryTime) {
                console.log(`S3 cache expired for: ${cacheKey}`);
                return null;
            }

            // Get the actual audio data
            const getCommand = new GetObjectCommand(params);
            const response = await this.s3Client.send(getCommand);
            
            console.log(`S3 cache hit for: ${cacheKey}`);
            return response.Body;
        } catch (error) {
            if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
                console.log(`S3 cache miss for: ${cacheKey}`);
                return null;
            }
            console.error("Error retrieving from S3 cache:", error);
            throw error;
        }
    }

    // Store audio in S3 cache
    async storeInS3Cache(cacheKey, audioStream, metadata = {}) {
        try {
            // Convert stream to buffer if needed
            let audioBuffer;
            if (audioStream instanceof Readable) {
                audioBuffer = await this.streamToBuffer(audioStream);
            } else {
                audioBuffer = audioStream;
            }

            const params = {
                Bucket: this.bucketName,
                Key: `audio-cache/${cacheKey}.mp3`,
                Body: audioBuffer,
                ContentType: "audio/mpeg",
                CacheControl: "max-age=86400", // 24 hours
                Metadata: {
                    ...metadata,
                    cachedAt: new Date().toISOString()
                }
            };

            const command = new PutObjectCommand(params);
            await this.s3Client.send(command);
            
            console.log(`Stored in S3 cache: ${cacheKey}`);
            
            // Also store in memory cache for faster access
            this.storeInMemoryCache(cacheKey, audioBuffer);
            
            return true;
        } catch (error) {
            console.error("Error storing in S3 cache:", error);
            throw error;
        }
    }

    // Get cached audio or return null if not found
    async getCachedAudio(text, voiceId, outputFormat = "mp3", engine = "neural") {
        const cacheKey = this.generateCacheKey(text, voiceId, outputFormat, engine);
        
        // First check memory cache
        let audioData = this.getFromMemoryCache(cacheKey);
        if (audioData) {
            return {
                audioData,
                source: 'memory',
                cacheKey
            };
        }

        // Then check S3 cache
        audioData = await this.getFromS3Cache(cacheKey);
        if (audioData) {
            // Store in memory cache for future access
            const buffer = await this.streamToBuffer(audioData);
            this.storeInMemoryCache(cacheKey, buffer);
            
            return {
                audioData: buffer,
                source: 's3',
                cacheKey
            };
        }

        return null;
    }

    // Cache new audio
    async cacheAudio(text, voiceId, audioStream, outputFormat = "mp3", engine = "neural") {
        const cacheKey = this.generateCacheKey(text, voiceId, outputFormat, engine);
        
        const metadata = {
            text: text.substring(0, 100), // Store first 100 chars for reference
            voiceId,
            outputFormat,
            engine
        };

        await this.storeInS3Cache(cacheKey, audioStream, metadata);
        
        return cacheKey;
    }

    // Invalidate CloudFront cache for specific audio
    async invalidateCloudFrontCache(cacheKey) {
        if (!this.cloudFrontDistributionId) {
            console.warn("CloudFront distribution ID not configured");
            return;
        }

        try {
            const params = {
                DistributionId: this.cloudFrontDistributionId,
                InvalidationBatch: {
                    Paths: {
                        Quantity: 1,
                        Items: [`/audio-cache/${cacheKey}.mp3`]
                    },
                    CallerReference: `invalidation-${Date.now()}`
                }
            };

            const command = new CreateInvalidationCommand(params);
            const response = await this.cloudFrontClient.send(command);
            
            console.log(`CloudFront invalidation created: ${response.Invalidation.Id}`);
            return response.Invalidation.Id;
        } catch (error) {
            console.error("Error invalidating CloudFront cache:", error);
            throw error;
        }
    }

    // Clear expired cache entries
    async clearExpiredCache() {
        try {
            // Clear expired memory cache
            const now = Date.now();
            for (const [key, value] of this.memoryCache.entries()) {
                if (now - value.timestamp > this.cacheExpiryTime) {
                    this.memoryCache.delete(key);
                }
            }

            console.log("Expired cache entries cleared");
        } catch (error) {
            console.error("Error clearing expired cache:", error);
        }
    }

    // Get cache statistics
    getCacheStats() {
        return {
            memoryCacheSize: this.memoryCache.size,
            maxMemoryCacheSize: this.maxMemoryCacheSize,
            cacheExpiryHours: this.cacheExpiryTime / (60 * 60 * 1000)
        };
    }

    // Utility function to convert stream to buffer
    async streamToBuffer(stream) {
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
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

        const voices = ["Joanna", "Matthew", "Amy", "Brian"];
        
        console.log("Starting pre-cache process for common alerts...");
        
        for (const alert of commonAlerts) {
            for (const voice of voices) {
                const cacheKey = this.generateCacheKey(alert, voice);
                
                // Check if already cached
                const cached = await this.getCachedAudio(alert, voice);
                if (!cached) {
                    console.log(`Pre-caching: "${alert}" with voice ${voice}`);
                    // This would typically involve generating the audio first
                    // For now, we'll just log the intent
                }
            }
        }
        
        console.log("Pre-cache process completed");
    }
}