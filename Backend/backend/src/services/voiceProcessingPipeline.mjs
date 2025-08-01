import 'dotenv/config';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { TranscribeClient } from '@aws-sdk/client-transcribe';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { EventEmitter } from 'events';

export class VoiceProcessingPipeline extends EventEmitter {
    constructor() {
        super();
        this.polly = new PollyClient({ region: process.env.AWS_REGION || 'ap-south-1' });
        this.transcribe = new TranscribeClient({ region: process.env.AWS_REGION || 'ap-south-1' });
        this.lambda = new LambdaClient({ region: process.env.AWS_REGION || 'ap-south-1' });
        this.processingQueue = [];
    }

    generateVoice(data) {
        console.log('Voice generated:', data);
        this.emit('voiceGenerated', data);
    }

    async processTextToSpeech(text, options = {}) {
        const {
            voiceId = 'Matthew',
            outputFormat = 'mp3',
            textType = 'text',
            engine = 'neural'
        } = options;

        const params = {
            Text: text,
            OutputFormat: outputFormat,
            VoiceId: voiceId,
            TextType: textType,
            Engine: engine
        };

        try {
            const command = new SynthesizeSpeechCommand(params);
            const result = await this.polly.send(command);

            return {
                success: true,
                audioStream: result.AudioStream,
                contentType: result.ContentType
            };
        } catch (error) {
            console.error('Polly TTS Error:', error);
            throw new Error(`Text-to-speech failed: ${error.message}`);
        }
    }

    async processSpeechToText(audioBuffer, options = {}) {
        // Placeholder for future Transcribe streaming logic
        return {
            success: true,
            transcript: 'Sample transcript',
            confidence: 0.95
        };
    }

    async processSafetyAlert(alertData) {
        const { message, severity, location } = alertData;
        const voiceOptions = this.getVoiceOptionsForSeverity(severity);
        const audioResult = await this.processTextToSpeech(message, voiceOptions);

        return {
            success: true,
            alertId: `alert_${Date.now()}`,
            audioBase64: Buffer.from(audioResult.audioStream).toString('base64'),
            contentType: audioResult.contentType,
            severity,
            location,
            timestamp: new Date().toISOString()
        };
    }

    getVoiceOptionsForSeverity(severity) {
        const voices = {
            low: { voiceId: 'Amy', engine: 'neural' },
            medium: { voiceId: 'Joanna', engine: 'neural' },
            high: { voiceId: 'Matthew', engine: 'neural' },
            critical: { voiceId: 'Matthew', engine: 'neural' }
        };
        return voices[severity] || voices.medium;
    }

    addToProcessingQueue(task) {
        this.processingQueue.push({
            ...task,
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            status: 'queued'
        });
    }

    async processQueue() {
        while (this.processingQueue.length > 0) {
            const task = this.processingQueue.shift();
            task.status = 'processing';

            try {
                let result;
                switch (task.type) {
                    case 'tts':
                        result = await this.processTextToSpeech(task.text, task.options);
                        break;
                    case 'stt':
                        result = await this.processSpeechToText(task.audioBuffer, task.options);
                        break;
                    case 'alert':
                        result = await this.processSafetyAlert(task.alertData);
                        break;
                    default:
                        throw new Error(`Unknown task type: ${task.type}`);
                }

                task.status = 'completed';
                task.result = result;
                if (task.callback) task.callback(null, result);
            } catch (error) {
                task.status = 'failed';
                task.error = error.message;
                if (task.callback) task.callback(error, null);
            }
        }
    }
}

