import { VoiceProcessingPipeline } from './voiceProcessingPipeline.mjs';
import fs from 'fs';

// Helper to convert audioStream (IncomingMessage) to Buffer
function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

async function testTTS() {
    try {
        const pipeline = new VoiceProcessingPipeline();

        const result = await pipeline.processTextToSpeech("Road safety alert: Please slow down!");

        // Convert readable stream to buffer
        const buffer = await streamToBuffer(result.audioStream);

        // Save to MP3 file
        fs.writeFileSync("alert.mp3", buffer);

        console.log("✅ alert.mp3 created successfully");
    } catch (error) {
        console.error("❌ TTS failed:", error.message);
    }
}

testTTS();
