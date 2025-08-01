import { polly } from '../config/awsSetup.mjs';
import { SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

class VoicePersonalityManager {
    constructor() {
        this.personalities = {
            emergency: {
                voiceId: 'Matthew',
                engine: 'neural',
                ssmlSettings: { rate: 'fast', pitch: '+20%', volume: 'loud' },
                prefix: '🚨 EMERGENCY: ',
                tone: 'urgent'
            },
            warning: {
                voiceId: 'Joanna',
                engine: 'neural',
                ssmlSettings: { rate: 'medium', pitch: '+10%', volume: 'medium' },
                prefix: '⚠️ WARNING: ',
                tone: 'concerned'
            },
            info: {
                voiceId: 'Amy',
                engine: 'neural',
                ssmlSettings: { rate: 'slow', pitch: 'medium', volume: 'medium' },
                prefix: 'ℹ️ INFO: ',
                tone: 'friendly'
            },
            navigation: {
                voiceId: 'Brian',
                engine: 'neural',
                ssmlSettings: { rate: 'medium', pitch: 'medium', volume: 'medium' },
                prefix: '🗺️ NAVIGATION: ',
                tone: 'professional'
            },
            calm: {
                voiceId: 'Salli',
                engine: 'neural',
                ssmlSettings: { rate: 'slow', pitch: '-10%', volume: 'soft' },
                prefix: '😌 ',
                tone: 'soothing'
            }
        };
    }

    async generatePersonalizedAlert(message, personalityType) {
        const personality = this.personalities[personalityType];
        if (!personality) throw new Error(`Unknown personality type: ${personalityType}`);

        const ssmlText = this.createSSMLText(message, personality);

        const params = {
            Text: ssmlText,
            TextType: 'ssml',
            OutputFormat: 'mp3',
            VoiceId: personality.voiceId,
            Engine: personality.engine
        };

        try {

            const command = new SynthesizeSpeechCommand(params);
            const result = await polly.send(command);

            return {
                success: true,
                personalityType,
                audioStream: result.AudioStream,
                contentType: result.ContentType,
                ssml: ssmlText,
                voiceSettings: personality
            };
        } catch (error) {
            console.error(`Error generating ${personalityType} alert:`, error);
            throw error;
        }
    }

    createSSMLText(message, personality) {
    const { ssmlSettings, prefix } = personality;

    return `
        <speak>
            <prosody rate="${ssmlSettings.rate}" volume="${ssmlSettings.volume}">
                ${prefix}${message}
            </prosody>
            <break time="0.5s"/>
        </speak>
    `.trim();
}
        
    getAvailablePersonalities() {
        return Object.entries(this.personalities).map(([key, val]) => ({
            type: key,
            description: val.tone,
            voiceId: val.voiceId
        }));
    }

    addCustomPersonality(name, config) {
        this.personalities[name] = {
            ...config,
            engine: config.engine || 'neural'
        };
    }

    async testAllPersonalities(testMessage = "This is a test road safety message") {
        const results = {};

        for (const type of Object.keys(this.personalities)) {
            try {
                console.log(`Testing ${type} personality...`);
                const result = await this.generatePersonalizedAlert(testMessage, type);
                results[type] = {
                    success: true,
                    audioSize: result.audioStream.length,
                    voiceId: this.personalities[type].voiceId
                };
            } catch (error) {
                results[type] = {
                    success: false,
                    error: error.message
                };
            }
        }

        return results;
    }
}

export default VoicePersonalityManager;
