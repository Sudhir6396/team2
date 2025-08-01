import { testAWSConnection } from '../src/config/awsSetup.mjs';
import { VoiceProcessingPipeline } from '../src/services/voiceProcessingPipeline.mjs';
import voicePersonalityManager from '../src/services/voicePersonalityManager.mjs';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ⛏️ Fix __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function testDay1Setup() {
    console.log('🧪 Testing Day 1 AWS Setup...\n');

    console.log('Test 1: AWS Connection');
    const awsConnected = await testAWSConnection();
    if (!awsConnected) {
        console.log('❌ AWS connection failed. Please check credentials.\n');
        return;
    }
    console.log('✅ AWS connection successful\n');

    console.log('Test 2: Voice Processing Pipeline');
    try {
        const pipeline = new VoiceProcessingPipeline();

        const result = await pipeline.processTextToSpeech(
            'This is a test road safety alert. Please drive carefully!'
        );

        const buffer = await streamToBuffer(result.audioStream);
        const outputPath = path.join(__dirname, 'test-alert.mp3');
        fs.writeFileSync(outputPath, buffer);

        console.log('✅ Text-to-Speech working');
        console.log(`   Audio saved to: ${outputPath}`);
        console.log(`   Content type: ${result.contentType}`);
    } catch (error) {
        console.log('❌ Voice Processing Pipeline error:', error.message);
    }

    console.log('\n🎉 Day 1 setup test completed!');
}
const voiceManager = new voicePersonalityManager();

(async () => {
    try {
        const result = await voiceManager.generatePersonalizedAlert(
            'Drive carefully near school zones.',
            'warning'
        );

        console.log(`✅ Alert synthesized using ${result.voiceSettings.voiceId}`);
        console.log(`🔉 SSML Used: ${result.ssml}`);
        console.log(`🧾 Content Type: ${result.contentType}`);
        console.log(`📦 Audio Stream Length: ${result.audioStream.length}`);

        // Optionally, save to file (if you're using fs/promises)
        // import { writeFile } from 'fs/promises';
        // await writeFile('warning-alert.mp3', result.audioStream);
    } catch (err) {
        console.error('❌ Error during synthesis:', err.message);
    }
})();


testDay1Setup().catch(console.error);
