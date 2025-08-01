import { PollyClient, DescribeVoicesCommand } from "@aws-sdk/client-polly";
import { TranscribeClient, ListTranscriptionJobsCommand } from "@aws-sdk/client-transcribe";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { fromEnv } from "@aws-sdk/credential-provider-env";



// ✅ AWS Configuration
const REGION = process.env.AWS_REGION || "ap-south-1";

// ✅ Shared credentials from environment
const credentials = fromEnv();

// ✅ Service Clients
const polly = new PollyClient({ region: REGION, credentials });
const transcribe = new TranscribeClient({ region: REGION, credentials });
const lambda = new LambdaClient({ region: REGION, credentials });
const s3 = new S3Client({ region: REGION, credentials });

// ✅ Connectivity Test
export async function testAWSConnection() {
    try {
        console.log("🔍 Testing AWS SDK v3 connectivity...");

        const voices = await polly.send(new DescribeVoicesCommand({}));
        console.log(`✅ Polly connected – ${voices.Voices.length} voices available`);

        const buckets = await s3.send(new ListBucketsCommand({}));
        console.log(`✅ S3 connected – ${buckets.Buckets.length} buckets accessible`);

        const functions = await lambda.send(new ListFunctionsCommand({}));
        console.log(`✅ Lambda connected – ${functions.Functions.length} functions available`);

        const jobs = await transcribe.send(new ListTranscriptionJobsCommand({}));
        console.log(`✅ Transcribe connected – ${jobs.TranscriptionJobSummaries.length} jobs found`);

        return true;
    } catch (error) {
        console.error("❌ AWS SDK v3 connectivity test failed:", error.message);
        return false;
    }
}

// ✅ Export clients for use in other modules
export {
    polly,
    transcribe,
    lambda,
    s3,
    REGION as awsRegion
};
