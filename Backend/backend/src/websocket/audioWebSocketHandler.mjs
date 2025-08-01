// backend/src/websocket/audioWebSocketHandler.mjs
import { VoiceCommandProcessor } from '../services/voiceCommandProcessor.mjs';
import { AudioCachingService } from '../services/audioCaching.mjs';

export class AudioWebSocketHandler {
    constructor() {
        this.voiceProcessor = new VoiceCommandProcessor();
        this.audioCache = new AudioCachingService();
        this.connections = new Set();
    }

    handleConnection(ws, request) {
        console.log('New audio WebSocket connection');
        this.connections.add(ws);

        // Send welcome message
        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Audio WebSocket connected successfully'
        }));

        // Handle messages
        ws.on('message', async (data) => {
            await this.handleMessage(ws, data);
        });

        // Handle disconnect
        ws.on('close', () => {
            console.log('Audio WebSocket disconnected');
            this.connections.delete(ws);
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.connections.delete(ws);
        });
    }

    async handleMessage(ws, data) {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'voice_command':
                    await this.handleVoiceCommand(ws, message);
                    break;
                
                case 'text_to_speech':
                    await this.handleTextToSpeech(ws, message);
                    break;
                
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                
                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `Unknown message type: ${message.type}`
                    }));
            }
        } catch (error) {
            console.error('Message handling error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process message',
                error: error.message
            }));
        }
    }

    // THIS IS THE MAIN VOICE COMMAND HANDLER
    async handleVoiceCommand(ws, message) {
        try {
            console.log('Processing voice command...');

            // Extract audio data
            let audioStream;
            if (message.audioData) {
                // Handle base64 encoded audio
                audioStream = Buffer.from(message.audioData, 'base64');
            } else if (message.audioBuffer) {
                // Handle raw audio buffer
                audioStream = Buffer.from(message.audioBuffer);
            } else {
                throw new Error('No audio data provided in voice command');
            }

            // Process the voice command
            const result = await this.voiceProcessor.processVoiceCommand(audioStream);

            // Send result back to client
            ws.send(JSON.stringify({
                type: 'voice_command_result',
                result: result,
                requestId: message.requestId || null,
                timestamp: new Date().toISOString()
            }));

            // Log the command for monitoring
            console.log(`Voice command processed: ${result.action}`);

        } catch (error) {
            console.error('Voice command processing error:', error);
            
            ws.send(JSON.stringify({
                type: 'voice_command_error',
                error: error.message,
                requestId: message.requestId || null,
                timestamp: new Date().toISOString()
            }));
        }
    }

    async handleTextToSpeech(ws, message) {
        try {
            const { text, voiceId = 'Joanna', requestId } = message;

            // Check cache first
            let audioResult = await this.audioCache.getCachedAudio(text, voiceId);
            
            if (!audioResult) {
                // Generate new audio if not cached
                const audioStream = await this.voiceProcessor.generateSpeech(text);
                await this.audioCache.cacheAudio(text, voiceId, audioStream);
                audioResult = { audioData: audioStream, source: 'generated' };
            }

            // Send audio back to client
            ws.send(JSON.stringify({
                type: 'text_to_speech_result',
                audioData: audioResult.audioData.toString('base64'),
                source: audioResult.source,
                requestId,
                timestamp: new Date().toISOString()
            }));

        } catch (error) {
            console.error('Text-to-speech error:', error);
            
            ws.send(JSON.stringify({
                type: 'text_to_speech_error',
                error: error.message,
                requestId: message.requestId || null
            }));
        }
    }

    // Broadcast message to all connected clients
    broadcast(message) {
        const messageStr = JSON.stringify(message);
        
        this.connections.forEach(ws => {
            if (ws.readyState === ws.OPEN) {
                ws.send(messageStr);
            }
        });
    }

    // Get connection count
    getConnectionCount() {
        return this.connections.size;
    }
}