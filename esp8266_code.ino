//ESP8266 Code for Smart Assistant (WAV Streaming via WebSockets)

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ESP8266Audio libraries
#include "AudioFileSourceHTTPStream.h"
#include "AudioGeneratorWAV.h"      // CHANGED: Using WAV instead of MP3 since server outputs .wav
#include "AudioOutputI2SNoDAC.h"

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Node.js server configurations
const char* server_host = "YOUR_SERVER_IP"; // Jaise: "192.168.1.15"
const int server_port   = 3000;

// ─── INSTANCES ───────────────────────────────────────────────────────────────
WebSocketsClient webSocket;

AudioGeneratorWAV *wav = NULL;      // CHANGED: AudioGeneratorWAV
AudioFileSourceHTTPStream *file = NULL;
AudioOutputI2SNoDAC *out = NULL;

// ─── HELPER FUNCTION TO STOP AUDIO ───────────────────────────────────────────
void stopAudio() {
    if (wav) {
        if (wav->isRunning()) {
            wav->stop();
        }
        delete wav; 
        wav = NULL;
    }
    if (file) { 
        delete file; 
        file = NULL; 
    }
    if (out) { 
        delete out; 
        out = NULL; 
    }
    Serial.println("[Audio] Playback stopped and memory cleared.");
}

// ─── WEBSOCKET EVENT HANDLER ─────────────────────────────────────────────────
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
    switch(type) {
        case WStype_DISCONNECTED:
            Serial.println("[WS] Disconnected from Server");
            break;
        case WStype_CONNECTED:
            Serial.println("[WS] Connected to Server");
            break;
        case WStype_TEXT: {
            Serial.printf("[WS] Message received: %s\n", payload);

            // Allocate JSON document
            JsonDocument doc;
            DeserializationError error = deserializeJson(doc, payload, length);

            if (error) {
                Serial.print(R"(deserializeJson() failed: )");
                Serial.println(error.c_str());
                return;
            }

            const char* event = doc["event"];

            // 1. Handle Audio Available Event
            if (strcmp(event, "audio_available") == 0) {
                const char* audio_url = doc["url"];
                if (audio_url) {
                    Serial.printf("[Audio] Streaming from URL: %s\n", audio_url);
                    
                    // Pehle purana audio stop karo (memory leak bachane ke liye)
                    stopAudio();

                    // Naya stream setup karo
                    file = new AudioFileSourceHTTPStream(audio_url);
                    out = new AudioOutputI2SNoDAC();
                    wav = new AudioGeneratorWAV();   // CHANGED: Instantiating AudioGeneratorWAV
                    
                    wav->begin(file, out);
                }
            }
            // 2. Handle Queue Reset Event
            else if (strcmp(event, "queue_reset") == 0) {
                Serial.println("[Audio] Reset command received.");
                stopAudio();
            }
            break;
        }
        default:
            break;
    }
}

// ─── SETUP ───────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(1000);

    // Connect to WiFi
    WiFi.begin(ssid, password);
    Serial.print("\nConnecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    // Play startup/connection sound
    char connect_url[128];
    sprintf(connect_url, "http://%s:%d/api/connect-audio", server_host, server_port);
    Serial.printf("[Audio] Playing connection sound: %s\n", connect_url);
    file = new AudioFileSourceHTTPStream(connect_url);
    out = new AudioOutputI2SNoDAC();
    wav = new AudioGeneratorWAV();
    wav->begin(file, out);

    // Initialize WebSockets Client
    webSocket.begin(server_host, server_port, "/");
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000); // Reconnect every 5s if disconnected
}

// ─── LOOP ────────────────────────────────────────────────────────────────────
void loop() {
    webSocket.loop();
    
    // Audio background processing
    if (wav && wav->isRunning()) {    // CHANGED: Processing AudioGeneratorWAV
        if (!wav->loop()) {
            wav->stop();
            Serial.println("[Audio] Finished playing stream.");
        }
    }
}
