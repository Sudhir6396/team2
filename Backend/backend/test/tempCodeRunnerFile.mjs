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