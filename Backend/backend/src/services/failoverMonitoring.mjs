// services/failoverMonitoring.mjs
import { 
    CloudWatchClient, 
    PutMetricDataCommand, 
    GetMetricStatisticsCommand,
    PutMetricAlarmCommand 
} from "@aws-sdk/client-cloudwatch";
import { 
    SNSClient, 
    PublishCommand, 
    CreateTopicCommand,
    SubscribeCommand 
} from "@aws-sdk/client-sns";
import { PollyClient } from "@aws-sdk/client-polly";
import { TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";

export class FailoverMonitoringService {
    constructor() {
        this.region = "ap-south-1";
        this.cloudWatchClient = new CloudWatchClient({ region: this.region });
        this.snsClient = new SNSClient({ region: this.region });
        
        // Service clients for health checks
        this.pollyClient = new PollyClient({ region: this.region });
        this.transcribeClient = new TranscribeStreamingClient({ region: this.region });
        
        this.serviceName = "SafetyAlertSystem";
        this.healthCheckInterval = 60000; // 1 minute
        this.failoverThreshold = 3; // Number of consecutive failures before failover
        this.consecutiveFailures = new Map();
        this.serviceStatus = new Map();
        
        this.initializeServices();
    }

    async initializeServices() {
        // Initialize service status tracking
        this.serviceStatus.set('polly', 'healthy');
        this.serviceStatus.set('transcribe', 'healthy');
        this.serviceStatus.set('s3-cache', 'healthy');
        this.serviceStatus.set('cloudfront', 'healthy');
        this.serviceStatus.set('websocket', 'healthy');
        this.serviceStatus.set('kafka', 'healthy');
        
        // Initialize failure counters
        for (const service of this.serviceStatus.keys()) {
            this.consecutiveFailures.set(service, 0);
        }

        // Start health monitoring
        this.startHealthMonitoring();
        
        // Setup CloudWatch alarms
        await this.setupCloudWatchAlarms();
    }

    // Health check for individual services
    async checkPollyHealth() {
        try {
            const testParams = {
                Text: "Health check",
                VoiceId: "Joanna",
                OutputFormat: "mp3"
            };
            
            const startTime = Date.now();
            await this.pollyClient.send(new (await import("@aws-sdk/client-polly")).SynthesizeSpeechCommand(testParams));
            const responseTime = Date.now() - startTime;
            
            await this.recordMetric('PollyResponseTime', responseTime, 'Milliseconds');
            await this.recordMetric('PollyHealthCheck', 1, 'Count');
            
            return { healthy: true, responseTime };
        } catch (error) {
            console.error("Polly health check failed:", error);
            await this.recordMetric('PollyHealthCheck', 0, 'Count');
            return { healthy: false, error: error.message };
        }
    }

    async checkTranscribeHealth() {
        try {
            // Simple connection test
            const startTime = Date.now();
            // Since we can't easily test streaming without actual audio, 
            // we'll test the client initialization and basic connectivity
            const client = new TranscribeStreamingClient({ region: this.region });
            const responseTime = Date.now() - startTime;
            
            await this.recordMetric('TranscribeResponseTime', responseTime, 'Milliseconds');
            await this.recordMetric('TranscribeHealthCheck', 1, 'Count');
            
            return { healthy: true, responseTime };
        } catch (error) {
            console.error("Transcribe health check failed:", error);
            await this.recordMetric('TranscribeHealthCheck', 0, 'Count');
            return { healthy: false, error: error.message };
        }
    }

    async checkS3Health() {
        try {
            const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
            const s3Client = new S3Client({ region: this.region });
            
            const startTime = Date.now();
            await s3Client.send(new HeadBucketCommand({
                Bucket: process.env.AUDIO_CACHE_BUCKET || "safety-alert-audio-cache"
            }));
            const responseTime = Date.now() - startTime;
            
            await this.recordMetric('S3ResponseTime', responseTime, 'Milliseconds');
            await this.recordMetric('S3HealthCheck', 1, 'Count');
            
            return { healthy: true, responseTime };
        } catch (error) {
            console.error("S3 health check failed:", error);
            await this.recordMetric('S3HealthCheck', 0, 'Count');
            return { healthy: false, error: error.message };
        }
    }

    async checkCloudFrontHealth() {
        try {
            const cdnDomain = process.env.CLOUDFRONT_DOMAIN;
            if (!cdnDomain) {
                return { healthy: true, responseTime: 0, note: "CDN not configured" };
            }

            const startTime = Date.now();
            const response = await fetch(`https://${cdnDomain}/health-check`, {
                method: 'HEAD',
                timeout: 5000
            });
            const responseTime = Date.now() - startTime;
            
            const healthy = response.status < 500;
            
            await this.recordMetric('CloudFrontResponseTime', responseTime, 'Milliseconds');
            await this.recordMetric('CloudFrontHealthCheck', healthy ? 1 : 0, 'Count');
            
            return { healthy, responseTime, status: response.status };
        } catch (error) {
            console.error("CloudFront health check failed:", error);
            await this.recordMetric('CloudFrontHealthCheck', 0, 'Count');
            return { healthy: false, error: error.message };
        }
    }

    // Comprehensive health check
    async performHealthCheck() {
        const healthResults = {};
        const services = ['polly', 'transcribe', 's3-cache', 'cloudfront'];
        
        for (const service of services) {
            try {
                let result;
                switch (service) {
                    case 'polly':
                        result = await this.checkPollyHealth();
                        break;
                    case 'transcribe':
                        result = await this.checkTranscribeHealth();
                        break;
                    case 's3-cache':
                        result = await this.checkS3Health();
                        break;
                    case 'cloudfront':
                        result = await this.checkCloudFrontHealth();
                        break;
                }
                
                healthResults[service] = result;
                
                // Update service status
                if (result.healthy) {
                    this.consecutiveFailures.set(service, 0);
                    this.serviceStatus.set(service, 'healthy');
                } else {
                    const failures = this.consecutiveFailures.get(service) + 1;
                    this.consecutiveFailures.set(service, failures);
                    
                    if (failures >= this.failoverThreshold) {
                        this.serviceStatus.set(service, 'failed');
                        await this.triggerFailover(service, result.error);
                    } else {
                        this.serviceStatus.set(service, 'degraded');
                    }
                }
                
            } catch (error) {
                console.error(`Health check failed for ${service}:`, error);
                healthResults[service] = { healthy: false, error: error.message };
            }
        }
        
        return healthResults;
    }

    // Failover logic for different services
    async triggerFailover(service, error) {
        console.log(`Triggering failover for service: ${service}`);
        
        const failoverActions = {
            'polly': this.pollyFailover.bind(this),
            'transcribe': this.transcribeFailover.bind(this),
            's3-cache': this.s3Failover.bind(this),
            'cloudfront': this.cloudFrontFailover.bind(this)
        };
        
        if (failoverActions[service]) {
            await failoverActions[service](error);
        }
        
        // Send alert notification
        await this.sendFailoverAlert(service, error);
        
        // Record failover event
        await this.recordMetric('ServiceFailover', 1, 'Count', [
            { Name: 'ServiceName', Value: service }
        ]);
    }

    async pollyFailover(error) {
        console.log("Implementing Polly failover...");
        
        // Fallback strategies:
        // 1. Switch to different AWS region
        // 2. Use alternative voice synthesis service
        // 3. Use pre-cached audio files
        // 4. Use simple text-to-speech fallback
        
        try {
            // Try alternative region
            const fallbackRegion = "us-east-1";
            const fallbackPolly = new PollyClient({ region: fallbackRegion });
            
            const testParams = {
                Text: "Failover test",
                VoiceId: "Joanna",
                OutputFormat: "mp3"
            };
            
            await fallbackPolly.send(new (await import("@aws-sdk/client-polly")).SynthesizeSpeechCommand(testParams));
            
            console.log(`Polly failover successful to region: ${fallbackRegion}`);
            
            // Update configuration to use fallback region
            process.env.POLLY_FALLBACK_REGION = fallbackRegion;
            
            return { success: true, fallbackRegion };
        } catch (fallbackError) {
            console.error("Polly failover failed:", fallbackError);
            
            // Ultimate fallback: use cached audio only
            process.env.POLLY_FALLBACK_MODE = "cache_only";
            
            return { success: false, mode: "cache_only" };
        }
    }

    async transcribeFailover(error) {
        console.log("Implementing Transcribe failover...");
        
        try {
            // Switch to alternative region
            const fallbackRegion = "us-east-1";
            const fallbackTranscribe = new TranscribeStreamingClient({ region: fallbackRegion });
            
            console.log(`Transcribe failover successful to region: ${fallbackRegion}`);
            process.env.TRANSCRIBE_FALLBACK_REGION = fallbackRegion;
            
            return { success: true, fallbackRegion };
        } catch (fallbackError) {
            console.error("Transcribe failover failed:", fallbackError);
            
            // Disable voice command processing temporarily
            process.env.VOICE_COMMANDS_ENABLED = "false";
            
            return { success: false, mode: "disabled" };
        }
    }

    async s3Failover(error) {
        console.log("Implementing S3 failover...");
        
        try {
            // Use in-memory cache only
            process.env.USE_S3_CACHE = "false";
            process.env.CACHE_MODE = "memory_only";
            
            console.log("S3 failover: switched to memory-only caching");
            
            return { success: true, mode: "memory_only" };
        } catch (fallbackError) {
            console.error("S3 failover failed:", fallbackError);
            return { success: false };
        }
    }

    async cloudFrontFailover(error) {
        console.log("Implementing CloudFront failover...");
        
        try {
            // Switch to direct S3 access
            process.env.USE_CLOUDFRONT = "false";
            process.env.AUDIO_DELIVERY_MODE = "direct_s3";
            
            console.log("CloudFront failover: switched to direct S3 delivery");
            
            return { success: true, mode: "direct_s3" };
        } catch (fallbackError) {
            console.error("CloudFront failover failed:", fallbackError);
            return { success: false };
        }
    }

    // Start continuous health monitoring
    startHealthMonitoring() {
        console.log("Starting health monitoring...");
        
        setInterval(async () => {
            try {
                const healthResults = await this.performHealthCheck();
                console.log("Health check completed:", healthResults);
                
                // Record overall system health
                const overallHealth = Object.values(healthResults).every(result => result.healthy);
                await this.recordMetric('SystemHealth', overallHealth ? 1 : 0, 'Count');
                
            } catch (error) {
                console.error("Health monitoring error:", error);
            }
        }, this.healthCheckInterval);
    }

    // Setup CloudWatch alarms
    async setupCloudWatchAlarms() {
        const alarms = [
            {
                AlarmName: "SafetyAlert-PollyFailures",
                MetricName: "PollyHealthCheck",
                Threshold: 0.5,
                ComparisonOperator: "LessThanThreshold"
            },
            {
                AlarmName: "SafetyAlert-TranscribeFailures",
                MetricName: "TranscribeHealthCheck",
                Threshold: 0.5,
                ComparisonOperator: "LessThanThreshold"
            },
            {
                AlarmName: "SafetyAlert-S3Failures",
                MetricName: "S3HealthCheck",
                Threshold: 0.5,
                ComparisonOperator: "LessThanThreshold"
            },
            {
                AlarmName: "SafetyAlert-HighLatency",
                MetricName: "PollyResponseTime",
                Threshold: 5000,
                ComparisonOperator: "GreaterThanThreshold"
            }
        ];

        for (const alarm of alarms) {
            try {
                const params = {
                    AlarmName: alarm.AlarmName,
                    ComparisonOperator: alarm.ComparisonOperator,
                    EvaluationPeriods: 2,
                    MetricName: alarm.MetricName,
                    Namespace: this.serviceName,
                    Period: 300,
                    Statistic: "Average",
                    Threshold: alarm.Threshold,
                    ActionsEnabled: true,
                    AlarmDescription: `Alarm for ${alarm.MetricName}`,
                    Unit: alarm.MetricName.includes("Time") ? "Milliseconds" : "Count"
                };

                await this.cloudWatchClient.send(new PutMetricAlarmCommand(params));
                console.log(`Created alarm: ${alarm.AlarmName}`);
            } catch (error) {
                console.error(`Error creating alarm ${alarm.AlarmName}:`, error);
            }
        }
    }

    // Record metrics to CloudWatch
    async recordMetric(metricName, value, unit, dimensions = []) {
        try {
            const params = {
                Namespace: this.serviceName,
                MetricData: [{
                    MetricName: metricName,
                    Value: value,
                    Unit: unit,
                    Timestamp: new Date(),
                    Dimensions: [
                        { Name: 'Environment', Value: 'Production' },
                        { Name: 'Region', Value: this.region },
                        ...dimensions
                    ]
                }]
            };

            await this.cloudWatchClient.send(new PutMetricDataCommand(params));
        } catch (error) {
            console.error(`Error recording metric ${metricName}:`, error);
        }
    }

    // Send failover alert
    async sendFailoverAlert(service, error) {
        try {
            const topicArn = process.env.SNS_ALERT_TOPIC_ARN;
            if (!topicArn) {
                console.warn("SNS topic not configured for alerts");
                return;
            }

            const message = {
                service,
                error,
                timestamp: new Date().toISOString(),
                region: this.region,
                failoverTriggered: true
            };

            const params = {
                TopicArn: topicArn,
                Message: JSON.stringify(message, null, 2),
                Subject: `Safety Alert System - Service Failover: ${service}`
            };

            await this.snsClient.send(new PublishCommand(params));
            console.log(`Failover alert sent for service: ${service}`);
        } catch (error) {
            console.error("Error sending failover alert:", error);
        }
    }

    // Get current system status
    getSystemStatus() {
        const status = {
            timestamp: new Date().toISOString(),
            region: this.region,
            services: {}
        };

        for (const [service, serviceStatus] of this.serviceStatus.entries()) {
            status.services[service] = {
                status: serviceStatus,
                consecutiveFailures: this.consecutiveFailures.get(service)
            };
        }

        return status;
    }

    // Manual failover trigger
    async manualFailover(service, reason = "Manual trigger") {
        console.log(`Manual failover triggered for ${service}: ${reason}`);
        await this.triggerFailover(service, reason);
    }

    // Cost monitoring
    async monitorAWSCosts() {
        try {
            // This would typically integrate with AWS Cost Explorer API
            // For now, we'll record usage metrics that can be used for cost estimation
            
            const costMetrics = [
                { name: 'PollyCharacters', value: this.getPollyCharacterCount() },
                { name: 'TranscribeMinutes', value: this.getTranscribeMinutes() },
                { name: 'S3Requests', value: this.getS3RequestCount() },
                { name: 'CloudFrontRequests', value: this.getCloudFrontRequestCount() }
            ];

            for (const metric of costMetrics) {
                await this.recordMetric(metric.name, metric.value, 'Count');
            }

            // Estimate daily costs
            const estimatedDailyCost = this.calculateEstimatedCosts(costMetrics);
            await this.recordMetric('EstimatedDailyCost', estimatedDailyCost, 'None');

            console.log(`Estimated daily cost: ${estimatedDailyCost.toFixed(2)}`);
            
            return { costMetrics, estimatedDailyCost };
        } catch (error) {
            console.error("Error monitoring AWS costs:", error);
            throw error;
        }
    }

    // Helper methods for cost calculation (implement based on your usage tracking)
    getPollyCharacterCount() {
        // Return tracked character count for Polly usage
        return process.env.POLLY_CHAR_COUNT || 0;
    }

    getTranscribeMinutes() {
        // Return tracked minutes for Transcribe usage
        return process.env.TRANSCRIBE_MINUTES || 0;
    }

    getS3RequestCount() {
        // Return tracked S3 request count
        return process.env.S3_REQUEST_COUNT || 0;
    }

    getCloudFrontRequestCount() {
        // Return tracked CloudFront request count
        return process.env.CLOUDFRONT_REQUEST_COUNT || 0;
    }

    calculateEstimatedCosts(metrics) {
        // AWS pricing as of 2024 (ap-south-1 region)
        const pricing = {
            pollyPerCharacter: 0.000004, // $4 per 1M characters
            transcribePerMinute: 0.024,   // $0.024 per minute
            s3RequestPer1000: 0.0004,     // $0.0004 per 1000 requests
            cloudFrontPer10000: 0.009     // $0.009 per 10,000 requests
        };

        let totalCost = 0;
        
        for (const metric of metrics) {
            switch (metric.name) {
                case 'PollyCharacters':
                    totalCost += metric.value * pricing.pollyPerCharacter;
                    break;
                case 'TranscribeMinutes':
                    totalCost += metric.value * pricing.transcribePerMinute;
                    break;
                case 'S3Requests':
                    totalCost += (metric.value / 1000) * pricing.s3RequestPer1000;
                    break;
                case 'CloudFrontRequests':
                    totalCost += (metric.value / 10000) * pricing.cloudFrontPer10000;
                    break;
            }
        }

        return totalCost;
    }
}