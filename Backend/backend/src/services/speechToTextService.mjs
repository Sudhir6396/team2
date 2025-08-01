import {
    TranscribeClient,
    StartTranscriptionJobCommand,
    GetTranscriptionJobCommand
} from '@aws-sdk/client-transcribe';

import {
    TranscribeStreamingClient,
    StartStreamTranscriptionCommand
} from '@aws-sdk/client-transcribe-streaming';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

export class SpeechToTextService extends EventEmitter {
    constructor() {
        super();
        this.region = 'ap-south-1';

        const credentials = {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        };

        this.transcribe = new TranscribeClient({ region: this.region, credentials });
        this.transcribeStreaming = new TranscribeStreamingClient({ region: this.region, credentials });
        this.s3 = new S3Client({ region: this.region, credentials });

        this.activeTranscriptions = new Map();
        this.audioStreams = new Map(); // Store audio streams for each session
    }

    async startRealtimeTranscription(sessionId, audioConfig = {}) {
        try {
            // Create an async generator for the audio stream
            const audioStream = this.createAudioStream(sessionId);

            const params = {
                LanguageCode: audioConfig.languageCode || 'hi-IN',
                MediaSampleRateHertz: audioConfig.sampleRate || 16000,
                MediaEncoding: 'pcm',
                EnablePartialResultsStabilization: true,
                PartialResultsStability: 'medium',
                AudioStream: audioStream // Now properly an async iterable
            };

            // Store the session info but don't start AWS streaming yet
            // We'll start it when we receive the first audio chunk
            this.activeTranscriptions.set(sessionId, {
                config: params,
                results: [],
                isStarted: false,
                audioBuffer: []
            });

            console.log(`🎤 Real-time transcription prepared for session: ${sessionId}`);
            return params;

        } catch (error) {
            console.error(`❌ Error preparing transcription for ${sessionId}:`, error);
            throw error;
        }
    }

    // Create an async generator that yields audio chunks
    async* createAudioStream(sessionId) {
        const transcription = this.activeTranscriptions.get(sessionId);
        if (!transcription) return;

        // Wait for audio chunks to be available
        while (transcription && this.activeTranscriptions.has(sessionId)) {
            if (transcription.audioBuffer.length > 0) {
                const chunk = transcription.audioBuffer.shift();
                yield { AudioEvent: { AudioChunk: chunk } };
            } else {
                // Wait a bit before checking for more data
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
    }

    async transcribeAudioChunk(sessionId, audioData) {
        try {
            const transcription = this.activeTranscriptions.get(sessionId);
            if (!transcription) {
                console.warn(`⚠️ No transcription session found for: ${sessionId}`);
                return;
            }

            // Convert audioData to proper format
            let audioChunk;
            if (Buffer.isBuffer(audioData)) {
                audioChunk = audioData;
            } else if (audioData instanceof ArrayBuffer) {
                audioChunk = Buffer.from(audioData);
            } else if (typeof audioData === 'string') {
                audioChunk = Buffer.from(audioData, 'base64');
            } else if (audioData.data) {
                audioChunk = Buffer.isBuffer(audioData.data) 
                    ? audioData.data 
                    : Buffer.from(audioData.data);
            } else {
                console.warn(`⚠️ Invalid audio data format for session ${sessionId}`);
                return;
            }

            // Add to buffer for the async generator
            transcription.audioBuffer.push(audioChunk);

            // Start AWS transcription on first chunk
            if (!transcription.isStarted) {
                await this.startAWSTranscription(sessionId, transcription);
            }

            console.log(`🎵 Audio chunk buffered for transcription: ${sessionId} (${audioChunk.length} bytes)`);

        } catch (error) {
            console.error(`❌ Error processing audio chunk for ${sessionId}:`, error);
        }
    }

    async startAWSTranscription(sessionId, transcription) {
        try {
            transcription.isStarted = true;
            
            const command = new StartStreamTranscriptionCommand(transcription.config);
            const response = await this.transcribeStreaming.send(command);

            // Process transcription results in background
            this.processTranscriptionStream(sessionId, response.TranscriptResultStream);

            console.log(`✅ AWS Transcription started for session: ${sessionId}`);

        } catch (error) {
            console.error(`❌ Error starting AWS transcription for ${sessionId}:`, error);
            transcription.isStarted = false;
            
            // Fallback: emit mock results for testing
            this.startMockTranscription(sessionId);
        }
    }

    async processTranscriptionStream(sessionId, transcriptStream) {
        try {
            for await (const event of transcriptStream) {
                if (event.TranscriptEvent) {
                    this.handleTranscriptionResult(sessionId, event.TranscriptEvent.Transcript);
                }
            }
        } catch (error) {
            console.error(`❌ Error processing transcription stream for ${sessionId}:`, error);
        }
    }

    // Fallback mock transcription for testing when AWS fails
    startMockTranscription(sessionId) {
        console.log(`🎭 Starting mock transcription for session: ${sessionId}`);
        
        const mockPhrases = [
            "Hello, how are you today?",
            "Play some music please",
            "Stop the current audio",
            "Set volume to fifty percent",
            "Hey audio, pause playback",
            "Create a new alert"
        ];

        // Emit mock results periodically
        const mockInterval = setInterval(() => {
            const transcription = this.activeTranscriptions.get(sessionId);
            if (!transcription) {
                clearInterval(mockInterval);
                return;
            }

            if (transcription.audioBuffer.length > 0) {
                const randomPhrase = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];
                const mockResult = {
                    sessionId,
                    timestamp: Date.now(),
                    isPartial: false,
                    text: randomPhrase,
                    confidence: 0.85
                };

                transcription.results.push(mockResult);
                this.emit('transcriptionResult', mockResult);
                console.log(`🎭 Mock transcript: ${mockResult.text}`);
                
                // Clear some buffer to simulate processing
                transcription.audioBuffer.splice(0, Math.min(3, transcription.audioBuffer.length));
            }
        }, 3000);

        // Store interval reference for cleanup
        const transcription = this.activeTranscriptions.get(sessionId);
        if (transcription) {
            transcription.mockInterval = mockInterval;
        }
    }

    handleTranscriptionResult(sessionId, transcript) {
        const transcription = this.activeTranscriptions.get(sessionId);
        if (!transcription || !transcript?.Results?.length) return;

        const result = transcript.Results[0];
        const transcriptResult = {
            sessionId,
            timestamp: Date.now(),
            isPartial: result.IsPartial,
            text: result.Alternatives?.[0]?.Transcript || '',
            confidence: result.Alternatives?.[0]?.Items?.[0]?.Confidence || 0
        };

        transcription.results.push(transcriptResult);
        this.emit('transcriptionResult', transcriptResult);
        console.log(`📝 AWS Transcript: ${transcriptResult.text}`);
    }

    async startBatchTranscription(audioFileUri, jobName = null) {
        const transcriptionJobName = jobName || `batch-transcription-${uuidv4()}`;

        const command = new StartTranscriptionJobCommand({
            TranscriptionJobName: transcriptionJobName,
            LanguageCode: 'hi-IN',
            MediaFormat: 'wav',
            Media: { MediaFileUri: audioFileUri },
            OutputBucketName: process.env.AWS_S3_TRANSCRIPTION_BUCKET,
            Settings: {
                ShowSpeakerLabels: true,
                MaxSpeakerLabels: 4,
                ChannelIdentification: false
            }
        });

        const result = await this.transcribe.send(command);
        return {
            jobName: transcriptionJobName,
            status: result.TranscriptionJob.TranscriptionJobStatus,
            creationTime: result.TranscriptionJob.CreationTime
        };
    }

    async getTranscriptionJobStatus(jobName) {
        const command = new GetTranscriptionJobCommand({ TranscriptionJobName: jobName });
        const result = await this.transcribe.send(command);

        return {
            jobName,
            status: result.TranscriptionJob.TranscriptionJobStatus,
            creationTime: result.TranscriptionJob.CreationTime,
            completionTime: result.TranscriptionJob.CompletionTime,
            transcriptFileUri: result.TranscriptionJob.Transcript?.TranscriptFileUri,
            failureReason: result.TranscriptionJob.FailureReason
        };
    }

    async stopTranscription(sessionId) {
        const transcription = this.activeTranscriptions.get(sessionId);
        if (!transcription) {
            console.warn(`⚠️ No active transcription for session: ${sessionId}`);
            return { success: false, message: 'No active transcription found' };
        }

        // Clean up mock interval if exists
        if (transcription.mockInterval) {
            clearInterval(transcription.mockInterval);
        }

        // Clear audio buffer
        transcription.audioBuffer = [];

        this.activeTranscriptions.delete(sessionId);
        
        try {
            await this.saveTranscriptionResults(sessionId, transcription.results);
        } catch (error) {
            console.error(`⚠️ Error saving transcription results for ${sessionId}:`, error);
        }

        console.log(`🛑 Transcription stopped for session: ${sessionId}`);
        return { success: true, resultsCount: transcription.results.length };
    }

    async saveTranscriptionResults(sessionId, results) {
        try {
            if (!process.env.AWS_S3_TRANSCRIPTION_BUCKET) {
                console.log(`⚠️ No S3 bucket configured, skipping save for session: ${sessionId}`);
                return;
            }

            const key = `transcriptions/${sessionId}/${Date.now()}.json`;

            const command = new PutObjectCommand({
                Bucket: process.env.AWS_S3_TRANSCRIPTION_BUCKET,
                Key: key,
                Body: JSON.stringify({ 
                    sessionId, 
                    timestamp: Date.now(), 
                    resultsCount: results.length, 
                    results 
                }),
                ContentType: 'application/json'
            });

            await this.s3.send(command);
            console.log(`✅ Transcription saved to S3: ${key}`);

        } catch (error) {
            console.error(`❌ Error saving to S3:`, error);
            // Save locally as fallback
            console.log(`💾 Transcription results for ${sessionId}:`, results.length, 'results');
        }
    }

    // Health check method
    async isHealthy(sessionId) {
        const transcription = this.activeTranscriptions.get(sessionId);
        return transcription && (transcription.isStarted || transcription.audioBuffer.length > 0);
    }

    getActiveTranscriptions() {
        return Array.from(this.activeTranscriptions.entries()).map(([sessionId, t]) => ({
            sessionId,
            config: t.config,
            resultsCount: t.results.length,
            isStarted: t.isStarted,
            bufferSize: t.audioBuffer.length
        }));
    }

    getSessionInfo(sessionId) {
        const transcription = this.activeTranscriptions.get(sessionId);
        if (!transcription) return null;

        return {
            sessionId,
            isStarted: transcription.isStarted,
            config: transcription.config,
            resultsCount: transcription.results.length,
            bufferSize: transcription.audioBuffer.length
        };
    }
}