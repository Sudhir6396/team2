import { AudioStreamingService } from './audioStreamingService.mjs';
import { SpeechToTextService } from './speechToTextService.mjs';
import { KafkaAudioService } from './kafkaAudioService.mjs';
import { VoiceProcessingPipeline } from './voiceProcessingPipeline.mjs';

import { EventEmitter } from 'events';

export class AudioIntegrationService extends EventEmitter {
    constructor() {
        super();
        this.streamingService = new AudioStreamingService();
        this.speechService = new SpeechToTextService();
        this.kafkaService = new KafkaAudioService();
        this.voiceManager = new VoiceProcessingPipeline();
        this.sessions = new Map();
        this.isInitialized = false;
        this.setupEventHandlers();
    }

    async initialize() {
        try {
            console.log('🔄 Initializing Audio Integration Service...');
            await this.kafkaService.initialize();
            
            // Check if voiceManager has initialize method before calling it
            if (this.voiceManager && typeof this.voiceManager.initialize === 'function') {
                await this.voiceManager.initialize();
            } else {
                console.log('⚠️ VoiceManager initialize method not available - skipping');
            }
            
            this.isInitialized = true;
            console.log('✅ Audio Integration Service initialized');
            this.emit('initialized');
        } catch (error) {
            console.error('❌ Initialization error:', error);
            throw error;
        }
    }

    setupEventHandlers() {
        this.streamingService.on('audioChunk', async data => this.handleAudioChunk(data));
        this.speechService.on('transcriptionResult', async result => this.handleTranscriptionResult(result));
        this.kafkaService.on('audioInput', async data => this.processAudioInput(data));
        this.kafkaService.on('voiceCommand', async data => this.processVoiceCommand(data));
        
        // Check if voiceManager has event emission before listening
        if (this.voiceManager && typeof this.voiceManager.on === 'function') {
            this.voiceManager.on('voiceGenerated', async data => this.handleVoiceGenerated(data));
        }
    }

    // REPLACE YOUR EXISTING startAudioSession METHOD WITH THIS ENHANCED VERSION
    async startAudioSession(sessionId, config = {}) {
        try {
            const sessionConfig = {
                sessionId,
                startTime: new Date(),
                audioConfig: {
                    sampleRate: config.sampleRate || 16000,
                    channels: config.channels || 1,
                    languageCode: config.languageCode || 'hi-IN'
                },
                voicePersonality: config.voicePersonality || 'Aditi',
                transcriptionEnabled: config.transcriptionEnabled !== false,
                voiceCommandsEnabled: config.voiceCommandsEnabled !== false
            };

            // Add safety checks for streaming service
            try {
                if (this.streamingService && typeof this.streamingService.createStream === 'function') {
                    await this.streamingService.createStream(sessionId, sessionConfig.audioConfig);
                } else {
                    console.log(`⚠️ StreamingService createStream not available for session ${sessionId}`);
                }
            } catch (streamError) {
                console.error(`⚠️ StreamingService error for ${sessionId}:`, streamError.message);
                // Continue without failing - streaming service is optional for basic functionality
            }

            // Add safety checks for transcription service
            if (sessionConfig.transcriptionEnabled) {
                try {
                    if (this.speechService && typeof this.speechService.startRealtimeTranscription === 'function') {
                        await this.speechService.startRealtimeTranscription(sessionId, sessionConfig.audioConfig);
                    } else {
                        console.log(`⚠️ SpeechService not available for session ${sessionId}`);
                    }
                } catch (speechError) {
                    console.error(`⚠️ SpeechService error for ${sessionId}:`, speechError.message);
                    // Continue without failing
                }
            }

            // Add safety checks for voice manager
            try {
                if (this.voiceManager && typeof this.voiceManager.setPersonality === 'function') {
                    await this.voiceManager.setPersonality(sessionId, sessionConfig.voicePersonality);
                }
            } catch (voiceError) {
                console.error(`⚠️ VoiceManager error for ${sessionId}:`, voiceError.message);
                // Continue without failing
            }

            this.sessions.set(sessionId, sessionConfig);
            this.emit('sessionStarted', { sessionId, config: sessionConfig });
            console.log(`🎙️ Audio session started: ${sessionId}`);
            return sessionConfig;
        } catch (error) {
            console.error('❌ Error starting audio session:', error);
            throw new Error(`Failed to start audio session: ${error.message}`);
        }
    }

    async handleAudioChunk({ sessionId, chunk }) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        if (session.transcriptionEnabled) {
            await this.speechService.transcribeAudioChunk(sessionId, chunk.data);
        }

        await this.kafkaService.publishAudioInput(sessionId, chunk, {
            source: 'streaming-service',
            personality: session.voicePersonality
        });
    }

    async handleTranscriptionResult({ sessionId, text, confidence }) {
        console.log(`📝 Transcription (${sessionId}): "${text}"`);
        await this.kafkaService.publishTranscriptionResult(sessionId, text, confidence);

        if (this.isVoiceCommand(text)) {
            await this.processVoiceCommandFromText(sessionId, text);
        }

        this.emit('transcriptionProcessed', { sessionId, text, confidence });
    }

    isVoiceCommand(text) {
        const keywords = ['hey audio', 'voice command', 'execute', 'play', 'stop', 'pause', 'alert', 'volume'];
        return keywords.some(k => text.toLowerCase().includes(k));
    }

    extractCommand(text) {
        const lowerText = text.toLowerCase();
        if (lowerText.includes('play')) return 'play';
        if (lowerText.includes('stop')) return 'stop';
        if (lowerText.includes('pause')) return 'pause';
        if (lowerText.includes('volume')) return 'volume';
        if (lowerText.includes('alert')) return 'alert';
        return 'unknown';
    }

    extractParameters(text) {
        const params = {};
        const volumeMatch = text.match(/volume\s+(\d+)/i);
        if (volumeMatch) params.volume = parseInt(volumeMatch[1]);
        const playMatch = text.match(/play\s+(.+)/i);
        if (playMatch) params.audioFile = playMatch[1].trim();
        return params;
    }

    async processVoiceCommandFromText(sessionId, text) {
        const command = this.extractCommand(text);
        const parameters = this.extractParameters(text);
        await this.kafkaService.publishVoiceCommand(sessionId, command, parameters);
    }

    async processAudioInput(data) {
        try {
            const { sessionId } = data;
            console.log(`📡 Audio input received for session: ${sessionId}`);
            this.emit('audioInputProcessed', data);
        } catch (error) {
            console.error('❌ Error processing audio input:', error);
        }
    }

    async processVoiceCommand(data) {
        const { sessionId, command, parameters } = data;
        const session = this.sessions.get(sessionId);
        if (!session) return;

        console.log(`⚙️ Voice command: ${command}`);

        switch (command) {
            case 'play': await this.handlePlayCommand(sessionId, parameters); break;
            case 'stop': await this.handleStopCommand(sessionId); break;
            case 'pause': await this.handlePauseCommand(sessionId); break;
            case 'volume': await this.handleVolumeCommand(sessionId, parameters); break;
            case 'alert': await this.handleAlertCommand(sessionId, parameters); break;
            default: console.log(`🤷 Unknown voice command: ${command}`);
        }

        this.emit('voiceCommandProcessed', data);
    }

    async handlePlayCommand(sessionId, parameters) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const text = `Playing ${parameters.audioFile || 'audio content'}`;
        
        // Check if generateVoice method exists
        if (this.voiceManager && typeof this.voiceManager.generateVoice === 'function') {
            const voice = await this.voiceManager.generateVoice(sessionId, text, session.voicePersonality);
            if (voice) {
                await this.streamingService.streamAudio(sessionId, voice.audioData, {
                    type: 'voice-response', command: 'play'
                });
            }
        } else {
            console.log('⚠️ VoiceManager generateVoice method not available');
        }
    }

    async handleStopCommand(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        if (this.voiceManager && typeof this.voiceManager.generateVoice === 'function') {
            const voice = await this.voiceManager.generateVoice(sessionId, 'Audio stopped', session.voicePersonality);
            if (voice) {
                await this.streamingService.streamAudio(sessionId, voice.audioData, {
                    type: 'voice-response', command: 'stop'
                });
            }
        }
    }

    async handlePauseCommand(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        if (this.voiceManager && typeof this.voiceManager.generateVoice === 'function') {
            const voice = await this.voiceManager.generateVoice(sessionId, 'Audio paused', session.voicePersonality);
            if (voice) {
                await this.streamingService.streamAudio(sessionId, voice.audioData, {
                    type: 'voice-response', command: 'pause'
                });
            }
        }
    }

    async handleVolumeCommand(sessionId, parameters) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const volume = parameters.volume || 50;
        
        if (this.voiceManager && typeof this.voiceManager.generateVoice === 'function') {
            const voice = await this.voiceManager.generateVoice(sessionId, `Volume set to ${volume} percent`, session.voicePersonality);
            if (voice) {
                await this.streamingService.streamAudio(sessionId, voice.audioData, {
                    type: 'voice-response', command: 'volume', volume
                });
            }
        }
    }

    async handleAlertCommand(sessionId, parameters) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const message = parameters.message || 'Alert triggered';
        const priority = parameters.priority || 'medium';
        await this.kafkaService.publishAudioAlert('voice-command', message, priority);

        if (this.voiceManager && typeof this.voiceManager.generateVoice === 'function') {
            const voice = await this.voiceManager.generateVoice(sessionId, `Alert created: ${message}`, session.voicePersonality);
            if (voice) {
                await this.streamingService.streamAudio(sessionId, voice.audioData, {
                    type: 'voice-response', command: 'alert'
                });
            }
        }
    }

    async handleVoiceGenerated(data) {
        const { sessionId, audioData, text } = data;
        console.log(`🔊 Voice generated (${sessionId}): ${text}`);
        await this.streamingService.streamAudio(sessionId, audioData, {
            type: 'generated-voice', originalText: text
        });
        this.emit('voiceStreamed', data);
    }

    getSessionStatus(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        return {
            sessionId,
            transcriptionEnabled: session.transcriptionEnabled,
            voiceCommandsEnabled: session.voiceCommandsEnabled,
            voicePersonality: session.voicePersonality,
            audioConfig: session.audioConfig,
            streamStatus: this.streamingService.getStreamStatus(sessionId),
            personalityStatus: this.voiceManager && typeof this.voiceManager.getPersonality === 'function' 
                ? this.voiceManager.getPersonality(sessionId) 
                : null,
            uptimeMs: Date.now() - session.startTime.getTime()
        };
    }

    getActiveSessions() {
        return Array.from(this.sessions.keys()).map(sessionId => ({
            sessionId,
            ...this.getSessionStatus(sessionId)
        }));
    }
}
export class VoiceManager {
    async initialize() {
        console.log('🎭 VoiceManager initialized');
        return true;
    }
    
    async setPersonality(sessionId, personality) {
        console.log(`🎭 Setting personality for ${sessionId}: ${personality}`);
        return { sessionId, personality };
    }
}