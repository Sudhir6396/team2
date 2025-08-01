import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

const polly = new PollyClient({
    region: "ap-south-1",
});

export async function handler(event) {
    const { text = "Test", voiceId = "Joanna", outputFormat = "mp3" } = JSON.parse(event.body || "{}");
    
    const command = new SynthesizeSpeechCommand({
        Text: text,
        OutputFormat: outputFormat,
        VoiceId: voiceId,
        Engine: "neural"
    });

    try {
        const result = await polly.send(command);
        const audio = await streamToBuffer(result.AudioStream);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                audioStream: audio.toString("base64"),
                contentType: result.ContentType
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
}

// Helper to convert stream to buffer
async function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", chunk => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
    });
}
