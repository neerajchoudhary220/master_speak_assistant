//ESP8266 Code for Smart Assistant (WAV Streaming via WebSockets)

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ESP8266Audio libraries
#include "AudioFileSourceHTTPStream.h"
#include "AudioFileSourceBuffer.h"  // ADDED: For smoothing out network stream jitter
#include "AudioGeneratorMP3.h"      // CHANGED: Using MP3 generator
#include "AudioOutputI2SNoDAC.h"

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const char* ssid     = "Home-wifi";
const char* password = "GoodBye@123";

// Node.js server configurations
const char* server_host = "160.250.204.157"; 
const int server_port   = 3000;

// Audio volume gain setting (0.0 to 4.0, where 1.0 is default, and 4.0 is maximum volume)
const float audio_gain   = 4.0;

// Buzzer Pin Define kiya hai (NodeMCU ka D1 pin yani GPIO 5)
#define BUZZER_PIN D1 

// ─── INSTANCES ───────────────────────────────────────────────────────────────
WebSocketsClient webSocket;

AudioGeneratorMP3 *mp3 = NULL;      // CHANGED: AudioGeneratorMP3
AudioFileSourceHTTPStream *file = NULL;
AudioFileSourceBuffer *buff = NULL; // ADDED: Buffer instance
AudioOutputI2SNoDAC *out = NULL;

// ─── HELPER FUNCTION TO STOP AUDIO ───────────────────────────────────────────
void stopAudio() {
    if (mp3) {
        if (mp3->isRunning()) {
            mp3->stop();
        }
        delete mp3; 
        mp3 = NULL;
    }
    if (buff) { 
        delete buff; 
        buff = NULL; 
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
                    buff = new AudioFileSourceBuffer(file, 2048); // ADDED: Buffer initialization
                    out = new AudioOutputI2SNoDAC();
                    out->SetGain(audio_gain);        // Set audio volume to full (gain of 4.0)
                    mp3 = new AudioGeneratorMP3();   // CHANGED: Instantiating AudioGeneratorMP3
                    
                    mp3->begin(buff, out); // CHANGED: pass buff instead of file
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

    // Buzzer pin ko output set kiya
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW); // Shuru me buzzer OFF rahega

    // --- FIX: Clear old WiFi cache and force Station mode ---
    WiFi.mode(WIFI_STA); 
    WiFi.disconnect();   
    delay(100);          
    // --------------------------------------------------------

    // Connect to WiFi
    WiFi.begin(ssid, password);
    Serial.print("\nConnecting to WiFi");
    
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
        yield(); // --- FIX: Background processes ko run karne dega taaki WDT reset na ho ---
    }
    
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    // --- BUZZER BEEP LOGIC (3 BAAR) ---
    Serial.println("Playing 3 Beeps...");
    for(int i = 0; i < 3; i++) {
        digitalWrite(BUZZER_PIN, HIGH); // Buzzer ON
        delay(150);                     // 150 milliseconds tak awaz karega
        digitalWrite(BUZZER_PIN, LOW);  // Buzzer OFF
        delay(150);                     // 150 milliseconds ka gap
    }
    // ----------------------------------

    // Play startup/connection sound (Server se mp3 file play hogi)
    char connect_url[128];
    sprintf(connect_url, "http://%s:%d/api/connect-audio", server_host, server_port);
    Serial.printf("[Audio] Playing connection sound: %s\n", connect_url);
    file = new AudioFileSourceHTTPStream(connect_url);
    buff = new AudioFileSourceBuffer(file, 2048); // ADDED: Buffer initialization
    out = new AudioOutputI2SNoDAC();
    out->SetGain(audio_gain);        // Set audio volume to full (gain of 4.0)
    mp3 = new AudioGeneratorMP3();   // CHANGED: Instantiating AudioGeneratorMP3
    mp3->begin(buff, out); // CHANGED: pass buff instead of file

    // Initialize WebSockets Client
    webSocket.begin(server_host, server_port, "/");
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000); // Reconnect every 5s if disconnected
}

// ─── LOOP ────────────────────────────────────────────────────────────────────
void loop() {
    webSocket.loop();
    
    // Audio background processing
    if (mp3 && mp3->isRunning()) {    
        if (!mp3->loop()) {
            mp3->stop();
            Serial.println("[Audio] Finished playing stream.");
        }
    }
}