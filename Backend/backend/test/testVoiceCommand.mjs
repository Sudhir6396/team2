// test/testVoiceCommand.mjs
import WebSocket from 'ws';
import fs from 'fs';

const ws = new WebSocket('ws://localhost:3000/audio-websocket');



ws.on('open', () => {
    console.log('Connected to WebSocket');
    
    // Send a test voice command
    const testAudio = fs.readFileSync('./backend/test/test-audio.wav'); // Your test audio file
    
    ws.send(JSON.stringify({
        type: 'voice_command',
        audioData: testAudio.toString('base64'),
        requestId: 'test-1'
    }));
});

ws.on('message', (data) => {
    const message = JSON.parse(data);
    console.log('Received:', message);
});