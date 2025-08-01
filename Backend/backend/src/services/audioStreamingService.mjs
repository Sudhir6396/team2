import { KinesisClient, CreateStreamCommand, PutRecordCommand } from '@aws-sdk/client-kinesis';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

export class AudioStreamingService extends EventEmitter {
    constructor() {
        super();
        this.region = 'ap-south-1';
        this.streams = new Map();
        this.buffers = new Map();
        this.connections = new Map();

        this.kinesis = new KinesisClient({
            region: this.region,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
        });

        this.s3 = new S3Client({
            region: this.region,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
        });
    }

    async createStream(sessionId, audioConfig = {}) {
        const streamConfig = {
            sessionId,
            sampleRate: audioConfig.sampleRate || 16000,
            channels: audioConfig.channels || 1,
            bitDepth: audioConfig.bitDepth || 16,
            format: audioConfig.format || 'pcm',
            bufferSize: audioConfig.bufferSize || 4096,
            created: new Date(),
            status: 'active'
        };

        this.streams.set(sessionId, streamConfig);
        this.buffers.set(sessionId, []);

        await this.createKinesisStream(sessionId);
        this.emit('streamCreated', { sessionId, config: streamConfig });
        return streamConfig;
    }

    async streamAudio(sessionId, audioData, metadata = {}) {
        if (!this.streams.has(sessionId)) {
            throw new Error(`Stream not found for session: ${sessionId}`);
        }

        const buffer = this.buffers.get(sessionId);
        const audioChunk = {
            data: audioData,
            timestamp: Date.now(),
            sequenceNumber: buffer.length,
            metadata
        };

        buffer.push(audioChunk);
        await this.sendToKinesis(sessionId, audioChunk);
        await this.broadcastToClients(sessionId, audioChunk);

        if (buffer.length > 100) buffer.shift();
        this.emit('audioChunk', { sessionId, chunk: audioChunk });

        return {
            success: true,
            sequenceNumber: audioChunk.sequenceNumber,
            bufferSize: buffer.length
        };
    }

    async createKinesisStream(sessionId) {
        const streamName = `audio-stream-${sessionId}`;
        try {
            await this.kinesis.send(new CreateStreamCommand({
                StreamName: streamName,
                ShardCount: 1
            }));
            console.log(`Kinesis stream created: ${streamName}`);
        } catch (error) {
            if (error.name !== 'ResourceInUseException') throw error;
        }
    }

    async sendToKinesis(sessionId, audioChunk) {
        const streamName = `audio-stream-${sessionId}`;
        const params = {
            StreamName: streamName,
            Data: Buffer.from(JSON.stringify(audioChunk)),
            PartitionKey: sessionId
        };
        await this.kinesis.send(new PutRecordCommand(params));
    }

    async broadcastToClients(sessionId, audioChunk) {
        const clients = this.connections.get(sessionId) || [];
        for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'audioChunk', data: audioChunk }));
            }
        }
    }

    addConnection(sessionId, ws) {
        if (!this.connections.has(sessionId)) {
            this.connections.set(sessionId, []);
        }
        this.connections.get(sessionId).push(ws);
    }

    getStreamStatus(sessionId) {
        const stream = this.streams.get(sessionId);
        const buffer = this.buffers.get(sessionId);
        if (!stream) return null;

        return {
            ...stream,
            bufferSize: buffer?.length || 0,
            connections: this.connections.get(sessionId)?.length || 0
        };
    }

    async closeStream(sessionId) {
        await this.saveBufferToS3(sessionId);
        this.streams.delete(sessionId);
        this.buffers.delete(sessionId);
        this.connections.delete(sessionId);
        this.emit('streamClosed', { sessionId });
    }

    async saveBufferToS3(sessionId) {
        const buffer = this.buffers.get(sessionId);
        if (!buffer || buffer.length === 0) return;

        const key = `audio-sessions/${sessionId}/${Date.now()}.json`;
        await this.s3.send(new PutObjectCommand({
            Bucket: process.env.AWS_S3_AUDIO_BUCKET,
            Key: key,
            Body: JSON.stringify(buffer),
            ContentType: 'application/json'
        }));
    }
}
