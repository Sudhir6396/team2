import { Kafka } from 'kafkajs';
import { EventEmitter } from 'events';

export class KafkaAudioService extends EventEmitter {
    constructor() {
        super();

        this.kafka = new Kafka({
            clientId: 'aws-audio-processor',
            brokers: [process.env.KAFKA_BROKER_URL || 'localhost:9092'],
            connectionTimeout: 3000,
            requestTimeout: 25000,
        });

        this.producer = this.kafka.producer({
            maxInFlightRequests: 1,
            idempotent: true,
            transactionTimeout: 30000,
        });

        this.consumer = this.kafka.consumer({
            groupId: 'audio-processing-group',
            sessionTimeout: 25000,
            heartbeatInterval: 3000,
        });

        this.admin = this.kafka.admin();
        this.isConnected = false;

        this.topics = {
            AUDIO_INPUT: 'audio-input',
            AUDIO_PROCESSED: 'audio-processed',
            TRANSCRIPTION_RESULT: 'transcription-result',
            VOICE_COMMAND: 'voice-command',
            AUDIO_ALERT: 'audio-alert'
        };
    }

    async initialize() {
        try {
            await this.admin.connect();
            await this.createTopics();
            await this.admin.disconnect();

            await this.producer.connect();
            await this.consumer.connect();
            await this.subscribeToTopics();

            this.isConnected = true;
            console.log('✅ KafkaAudioService initialized');
            this.emit('connected');
        } catch (error) {
            console.error('❌ Kafka initialization failed:', error);
            throw error;
        }
    }

    async createTopics() {
        const topicConfigs = Object.values(this.topics).map(topic => ({
            topic,
            numPartitions: 3,
            replicationFactor: 1,
            configEntries: [
                { name: 'cleanup.policy', value: 'delete' },
                { name: 'retention.ms', value: '86400000' },
            ]
        }));

        try {
            await this.admin.createTopics({ topics: topicConfigs, waitForLeaders: true });
            console.log('📦 Kafka topics created or already exist');
        } catch (error) {
            if (error.type !== 'TOPIC_ALREADY_EXISTS') {
                throw error;
            }
        }
    }

    async subscribeToTopics() {
        for (const topic of Object.values(this.topics)) {
            await this.consumer.subscribe({ topic, fromBeginning: false });
        }

        await this.consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                await this.handleMessage(topic, partition, message);
            }
        });

        console.log('📡 Kafka consumer subscribed to topics');
    }

    async handleMessage(topic, partition, message) {
        const messageData = {
            topic,
            partition,
            offset: message.offset,
            timestamp: message.timestamp,
            key: message.key?.toString(),
            value: JSON.parse(message.value.toString()),
            headers: message.headers
        };

        try {
            switch (topic) {
                case this.topics.AUDIO_INPUT:
                    this.emit('audioInput', messageData.value);
                    break;
                case this.topics.TRANSCRIPTION_RESULT:
                    this.emit('transcriptionResult', messageData.value);
                    break;
                case this.topics.VOICE_COMMAND:
                    this.emit('voiceCommand', messageData.value);
                    break;
                case this.topics.AUDIO_ALERT:
                    this.emit('audioAlert', messageData.value);
                    break;
                default:
                    console.warn(`⚠️ Unknown topic: ${topic}`);
            }

            this.emit('messageProcessed', messageData);
        } catch (error) {
            console.error('❌ Error handling Kafka message:', error);
            this.emit('messageError', { topic, partition, error });
        }
    }

    async publish(topicName, key, payload, headers = {}) {
        const message = {
            key,
            value: JSON.stringify({ ...payload, timestamp: Date.now() }),
            headers: {
                'content-type': 'application/json',
                source: 'KafkaAudioService',
                ...headers
            }
        };

        await this.producer.send({ topic: topicName, messages: [message] });
        return { success: true, topic: topicName };
    }

    publishAudioInput(sessionId, audioChunk, metadata = {}) {
        return this.publish(this.topics.AUDIO_INPUT, sessionId, { sessionId, audioChunk, metadata }, {
            source: 'audio-streaming-service'
        });
    }

    publishTranscriptionResult(sessionId, text, confidence, metadata = {}) {
        return this.publish(this.topics.TRANSCRIPTION_RESULT, sessionId, { sessionId, text, confidence, metadata }, {
            source: 'speech-to-text-service'
        });
    }

    publishVoiceCommand(sessionId, command, parameters = {}, metadata = {}) {
        return this.publish(this.topics.VOICE_COMMAND, sessionId, { sessionId, command, parameters, metadata }, {
            source: 'voice-command-processor'
        });
    }

    publishAudioAlert(alertType, message, priority = 'medium', metadata = {}) {
        const alertKey = `alert-${Date.now()}`;
        return this.publish(this.topics.AUDIO_ALERT, alertKey, { alertType, message, priority, metadata }, {
            source: 'audio-alert-service',
            priority
        });
    }

    getStatus() {
        return {
            isConnected: this.isConnected,
            topics: this.topics,
            brokers: this.kafka.brokers
        };
    }

    async disconnect() {
        await this.producer.disconnect();
        await this.consumer.disconnect();
        this.isConnected = false;
        this.emit('disconnected');
        console.log('🔌 Kafka disconnected');
    }
}
