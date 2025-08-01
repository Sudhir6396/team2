import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from "@aws-sdk/client-transcribe-streaming";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

export class VoiceCommandProcessor {
    constructor() {
        this.transcribeClient = new TranscribeStreamingClient({
            region: "ap-south-1"
        });
        this.pollyClient = new PollyClient({
            region: "ap-south-1"
        });
        this.commands = new Map();
        this.setupCommands();
    }

    setupCommands() {
        // Define voice commands and their actions
        this.commands.set("emergency alert", this.handleEmergencyAlert.bind(this));
        this.commands.set("weather update", this.handleWeatherUpdate.bind(this));
        this.commands.set("traffic alert", this.handleTrafficAlert.bind(this));
        this.commands.set("stop alert", this.handleStopAlert.bind(this));
        this.commands.set("repeat message", this.handleRepeatMessage.bind(this));
    }

    async processVoiceCommand(audioStream) {
        try {
            // Start transcription
            const transcriptionResult = await this.transcribeAudio(audioStream);
            const command = transcriptionResult.toLowerCase().trim();

            // Find matching command
            const matchedCommand = this.findBestMatch(command);

            if (matchedCommand) {
                return await this.commands.get(matchedCommand)(command);
            } else {
                return await this.handleUnknownCommand(command);
            }
        } catch (error) {
            console.error("Voice command processing error:", error);
            throw error;
        }
    }

    async transcribeAudio(audioStream) {
        const params = {
            LanguageCode: "en-US",
            MediaEncoding: "pcm",
            MediaSampleRateHertz: 16000,
            AudioStream: this.createAudioStream(audioStream)
        };

        const command = new StartStreamTranscriptionCommand(params);
        const response = await this.transcribeClient.send(command);

        // Process transcription results
        let transcription = "";
        for await (const event of response.TranscriptResultStream) {
            if (event.TranscriptEvent) {
                const results = event.TranscriptEvent.Transcript.Results;
                if (results.length > 0 && !results[0].IsPartial) {
                    transcription += results[0].Alternatives[0].Transcript + " ";
                }
            }
        }

        return transcription.trim();
    }

    createAudioStream(audioStream) {
        // Convert audio stream to async generator
        return (async function* () {
            for await (const chunk of audioStream) {
                yield { AudioEvent: { AudioChunk: chunk } };
            }
        })();
    }

    findBestMatch(command) {
        // Simple fuzzy matching
        for (const [key] of this.commands) {
            if (command.includes(key) || this.calculateSimilarity(command, key) > 0.7) {
                return key;
            }
        }
        return null;
    }

    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[str2.length][str1.length];
    }

    async handleEmergencyAlert(command) {
        const response = await this.generateSpeech("Emergency alert activated. Please stay calm and follow safety protocols.");
        return {
            action: "emergency_alert",
            audioResponse: response,
            priority: "high"
        };
    }

    async handleWeatherUpdate(command) {
        const response = await this.generateSpeech("Weather update requested. Fetching latest weather information.");
        return {
            action: "weather_update",
            audioResponse: response,
            priority: "normal"
        };
    }

    async handleTrafficAlert(command) {
        const response = await this.generateSpeech("Traffic alert activated. Checking current traffic conditions.");
        return {
            action: "traffic_alert",
            audioResponse: response,
            priority: "normal"
        };
    }

    async handleStopAlert(command) {
        const response = await this.generateSpeech("Alert stopped successfully.");
        return {
            action: "stop_alert",
            audioResponse: response,
            priority: "high"
        };
    }

    async handleRepeatMessage(command) {
        const response = await this.generateSpeech("Repeating last message.");
        return {
            action: "repeat_message",
            audioResponse: response,
            priority: "normal"
        };
    }

    async handleUnknownCommand(command) {
        const response = await this.generateSpeech("Sorry, I didn't understand that command. Please try again.");
        return {
            action: "unknown_command",
            audioResponse: response,
            priority: "low",
            originalCommand: command
        };
    }

    async generateSpeech(text) {
        const params = {
            OutputFormat: "mp3",
            Text: text,
            VoiceId: "Joanna",
            Engine: "neural"
        };

        const command = new SynthesizeSpeechCommand(params);
        const response = await this.pollyClient.send(command);

        return response.AudioStream;
    }
}