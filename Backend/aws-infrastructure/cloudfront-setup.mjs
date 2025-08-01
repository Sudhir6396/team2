
import { 
    CloudFormationClient, 
    CreateStackCommand, 
    DescribeStacksCommand,
    UpdateStackCommand 
} from "@aws-sdk/client-cloudformation";

export class CloudFrontCDNSetup {
    constructor() {
        this.cloudFormationClient = new CloudFormationClient({ region: "ap-south-1" });
        this.stackName = "safety-alert-audio-cdn";
    }

    // CloudFormation template for CDN setup
    getCDNTemplate() {
        return {
            AWSTemplateFormatVersion: "2010-09-09",
            Description: "CloudFront CDN for Safety Alert Audio Delivery",
            
            Parameters: {
                AudioCacheBucketName: {
                    Type: "String",
                    Default: "safety-alert-audio-cache",
                    Description: "S3 bucket name for audio cache"
                }
            },

            Resources: {
                // S3 Bucket for audio cache
                AudioCacheS3Bucket: {
                    Type: "AWS::S3::Bucket",
                    Properties: {
                        BucketName: { Ref: "AudioCacheBucketName" },
                        PublicAccessBlockConfiguration: {
                            BlockPublicAcls: true,
                            BlockPublicPolicy: true,
                            IgnorePublicAcls: true,
                            RestrictPublicBuckets: true
                        },
                        CorsConfiguration: {
                            CorsRules: [{
                                AllowedHeaders: ["*"],
                                AllowedMethods: ["GET", "HEAD"],
                                AllowedOrigins: ["*"],
                                MaxAge: 3600
                            }]
                        },
                        LifecycleConfiguration: {
                            Rules: [{
                                Id: "AudioCacheExpiration",
                                Status: "Enabled",
                                ExpirationInDays: 30,
                                Prefix: "audio-cache/"
                            }]
                        }
                    }
                },

                // Origin Access Control for CloudFront
                OriginAccessControl: {
                    Type: "AWS::CloudFront::OriginAccessControl",
                    Properties: {
                        OriginAccessControlConfig: {
                            Name: "AudioCacheOAC",
                            OriginAccessControlOriginType: "s3",
                            SigningBehavior: "always",
                            SigningProtocol: "sigv4"
                        }
                    }
                },

                // CloudFront Distribution
                AudioCDNDistribution: {
                    Type: "AWS::CloudFront::Distribution",
                    Properties: {
                        DistributionConfig: {
                            Comment: "CDN for Safety Alert Audio Files",
                            Enabled: true,
                            PriceClass: "PriceClass_100", // Use only North America and Europe edge locations
                            
                            Origins: [{
                                Id: "S3AudioCache",
                                DomainName: {
                                    "Fn::GetAtt": ["AudioCacheS3Bucket", "RegionalDomainName"]
                                },
                                S3OriginConfig: {
                                    OriginAccessIdentity: ""
                                },
                                OriginAccessControlId: { Ref: "OriginAccessControl" }
                            }],

                            DefaultCacheBehavior: {
                                TargetOriginId: "S3AudioCache",
                                ViewerProtocolPolicy: "redirect-to-https",
                                AllowedMethods: ["GET", "HEAD", "OPTIONS"],
                                CachedMethods: ["GET", "HEAD"],
                                Compress: true,
                                
                                CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", // Managed-CachingOptimized
                                OriginRequestPolicyId: "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf", // Managed-CORS-S3Origin
                                
                                // Custom cache behavior for audio files
                                ForwardedValues: {
                                    QueryString: false,
                                    Cookies: { Forward: "none" }
                                },
                                
                                // Cache for 24 hours
                                DefaultTTL: 86400,
                                MaxTTL: 31536000,
                                MinTTL: 0
                            },

                            // Cache behavior specifically for audio files
                            CacheBehaviors: [{
                                PathPattern: "audio-cache/*.mp3",
                                TargetOriginId: "S3AudioCache",
                                ViewerProtocolPolicy: "redirect-to-https",
                                AllowedMethods: ["GET", "HEAD"],
                                CachedMethods: ["GET", "HEAD"],
                                Compress: false, // Don't compress audio files
                                
                                ForwardedValues: {
                                    QueryString: false,
                                    Cookies: { Forward: "none" },
                                    Headers: ["Access-Control-Request-Headers", "Access-Control-Request-Method", "Origin"]
                                },
                                
                                // Longer cache for audio files
                                DefaultTTL: 86400,
                                MaxTTL: 31536000,
                                MinTTL: 86400
                            }],

                            // Custom error pages
                            CustomErrorResponses: [{
                                ErrorCode: 404,
                                ResponseCode: 404,
                                ResponsePagePath: "/error/404.html",
                                ErrorCachingMinTTL: 300
                            }],

                            // Logging configuration
                            Logging: {
                                Bucket: {
                                    "Fn::GetAtt": ["AudioCacheS3Bucket", "DomainName"]
                                },
                                IncludeCookies: false,
                                Prefix: "cloudfront-logs/"
                            }
                        }
                    }
                },

                // S3 Bucket Policy for CloudFront access
                AudioCacheBucketPolicy: {
                    Type: "AWS::S3::BucketPolicy",
                    Properties: {
                        Bucket: { Ref: "AudioCacheS3Bucket" },
                        PolicyDocument: {
                            Version: "2012-10-17",
                            Statement: [{
                                Sid: "AllowCloudFrontServicePrincipal",
                                Effect: "Allow",
                                Principal: {
                                    Service: "cloudfront.amazonaws.com"
                                },
                                Action: "s3:GetObject",
                                Resource: {
                                    "Fn::Sub": "${AudioCacheS3Bucket}/*"
                                },
                                Condition: {
                                    StringEquals: {
                                        "AWS:SourceArn": {
                                            "Fn::Sub": "arn:aws:cloudfront::${AWS::AccountId}:distribution/${AudioCDNDistribution}"
                                        }
                                    }
                                }
                            }]
                        }
                    }
                }
            },

            Outputs: {
                CloudFrontDistributionId: {
                    Description: "CloudFront Distribution ID",
                    Value: { Ref: "AudioCDNDistribution" },
                    Export: { Name: "AudioCDN-DistributionId" }
                },
                
                CloudFrontDomainName: {
                    Description: "CloudFront Distribution Domain Name",
                    Value: { "Fn::GetAtt": ["AudioCDNDistribution", "DomainName"] },
                    Export: { Name: "AudioCDN-DomainName" }
                },
                
                S3BucketName: {
                    Description: "S3 Bucket Name for Audio Cache",
                    Value: { Ref: "AudioCacheS3Bucket" },
                    Export: { Name: "AudioCDN-S3BucketName" }
                }
            }
        };
    }

    // Deploy CDN infrastructure
    async deployCDN(bucketName = "safety-alert-audio-cache") {
        try {
            const template = this.getCDNTemplate();
            
            const params = {
                StackName: this.stackName,
                TemplateBody: JSON.stringify(template, null, 2),
                Parameters: [{
                    ParameterKey: "AudioCacheBucketName",
                    ParameterValue: bucketName
                }],
                Capabilities: ["CAPABILITY_IAM"],
                Tags: [
                    { Key: "Project", Value: "SafetyAlertSystem" },
                    { Key: "Environment", Value: "Production" },
                    { Key: "Component", Value: "AudioCDN" }
                ]
            };

            // Check if stack exists
            let stackExists = false;
            try {
                await this.cloudFormationClient.send(new DescribeStacksCommand({
                    StackName: this.stackName
                }));
                stackExists = true;
            } catch (error) {
                if (error.name !== 'ValidationError') {
                    throw error;
                }
            }

            let command;
            if (stackExists) {
                console.log("Updating existing CDN stack...");
                command = new UpdateStackCommand(params);
            } else {
                console.log("Creating new CDN stack...");
                command = new CreateStackCommand(params);
            }

            const result = await this.cloudFormationClient.send(command);
            console.log(`CDN stack ${stackExists ? 'update' : 'creation'} initiated:`, result.StackId);
            
            return result;
        } catch (error) {
            console.error("Error deploying CDN:", error);
            throw error;
        }
    }

    // Get CDN configuration
    async getCDNConfiguration() {
        try {
            const command = new DescribeStacksCommand({
                StackName: this.stackName
            });
            
            const response = await this.cloudFormationClient.send(command);
            const stack = response.Stacks[0];
            
            if (stack.StackStatus !== 'CREATE_COMPLETE' && stack.StackStatus !== 'UPDATE_COMPLETE') {
                throw new Error(`Stack is in ${stack.StackStatus} state`);
            }

            const outputs = {};
            stack.Outputs.forEach(output => {
                outputs[output.OutputKey] = output.OutputValue;
            });

            return {
                distributionId: outputs.CloudFrontDistributionId,
                domainName: outputs.CloudFrontDomainName,
                bucketName: outputs.S3BucketName,
                cdnUrl: `https://${outputs.CloudFrontDomainName}`
            };
        } catch (error) {
            console.error("Error getting CDN configuration:", error);
            throw error;
        }
    }

    // Generate CDN URL for audio file
    generateCDNUrl(cacheKey, domainName) {
        return `https://${domainName}/audio-cache/${cacheKey}.mp3`;
    }
}

// Usage example and integration service
export class CDNAudioService {
    constructor() {
        this.cdnSetup = new CloudFrontCDNSetup();
        this.cdnConfig = null;
    }

    async initialize() {
        try {
            this.cdnConfig = await this.cdnSetup.getCDNConfiguration();
            console.log("CDN Service initialized:", this.cdnConfig);
        } catch (error) {
            console.error("CDN not deployed. Run deployCDN() first.");
            throw error;
        }
    }

    // Get optimized audio URL
    getAudioUrl(cacheKey) {
        if (!this.cdnConfig) {
            throw new Error("CDN service not initialized");
        }
        
        return this.cdnSetup.generateCDNUrl(cacheKey, this.cdnConfig.domainName);
    }

    // Get audio with CDN fallback
    async getOptimizedAudio(cacheKey) {
        if (!this.cdnConfig) {
            await this.initialize();
        }

        const cdnUrl = this.getAudioUrl(cacheKey);
        
        try {
            // Try to fetch from CDN first
            const response = await fetch(cdnUrl);
            if (response.ok) {
                return {
                    audioData: await response.arrayBuffer(),
                    source: 'cdn',
                    url: cdnUrl
                };
            }
        } catch (error) {
            console.error("CDN fetch failed:", error);
        }

        // Fallback to direct S3 access would be implemented here
        return null;
    }
}