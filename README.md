# Smart Assistant Bot: Deployment & ESP32 Integration Guide

This guide explains how to deploy the **Smart Assistant Bot** on an **Ubuntu Server** using **PM2** and **Python Virtual Environment (venv)**, and how to configure an **ESP32** to listen to the WebSocket server and stream the audio in real-time.

---

## Part 1: Ubuntu Server Deployment

### 1. Install System Dependencies

Update your server packages and install Node.js, Python, FFmpeg, and other utility tools:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ffmpeg python3 python3-venv python3-pip
```

Install Node.js (v18 or v20 LTS recommended):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify installations:

```bash
node -v
npm -v
python3 --version
ffmpeg -version
```

### 2. Project Directory Setup & Configuration

Clone or copy your project files into your server directory (e.g., `/var/www/master_speak_assistant`):

```bash
sudo mkdir -p /var/www/master_speak_assistant
sudo chown -R $USER:$USER /var/www/master_speak_assistant
cd /var/www/master_speak_assistant
```

Create and configure your `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GMAIL_USER=your_email@gmail.com
GMAIL_PASS=your_gmail_app_password
```

> [!IMPORTANT]
> Make sure `GMAIL_PASS` is a 16-character Google App Password (not your main account password) with IMAP enabled in your Gmail Settings.

### 3. Setup Python Virtual Environment (`venv`) for Piper TTS

Navigate into the `tts` directory, create a Python virtual environment, and install dependencies:

```bash
cd /var/www/master_speak_assistant/tts
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
```

Ensure that the models are downloaded into `tts/models/` folder:

- English Model: `en_US-ljspeech-high.onnx`
- Hindi Model: `hi_IN-fenil-medium.onnx` (or custom configured model)

### 4. Install Node.js Dependencies

Navigate back to the project root and install npm modules:

```bash
cd /var/www/master_speak_assistant
npm install
```

### 5. Setup PM2 (Process Manager)

Install PM2 globally to run the Node.js application permanently in the background:

```bash
sudo npm install -g pm2
```

Start the application using PM2:

```bash
pm2 start app.js --name "smart-assistant"
```

Configure PM2 to automatically launch the application on system reboot:

```bash
pm2 startup
```

_Note: PM2 will output a command containing `sudo env PATH=...`. Copy and run that exact command to configure the startup script._

Save the current process list:

```bash
pm2 save
```

#### Useful PM2 Commands:

```bash
pm2 logs "smart-assistant"       # View real-time logs
pm2 restart "smart-assistant"    # Restart application
pm2 stop "smart-assistant"       # Stop application
pm2 status                       # View application status
```

---

## Part 2: ESP32 Hardware Integration

To play the audio streams, we will configure the **ESP32** to connect to the Node.js WebSockets server. When the server broadcasts `audio_available`, the ESP32 fetches the audio URL via HTTP and plays it over a speaker using the I2S protocol. When it broadcasts `queue_reset`, the ESP32 stops the playback immediately.

### Hardware Prerequisites

- ESP32 Development Board (e.g. ESP32-WROOM-32)
- I2S DAC Audio Module (e.g. **MAX98357A** or **PCM5102**)
- Speaker (e.g. 8 Ohm 3W Speaker)

#### Pin Connections (ESP32 to MAX98357A I2S DAC):

| ESP32 Pin | MAX98357A Pin | Description  |
| --------- | ------------- | ------------ |
| GND       | GND           | Ground       |
| Vin (5V)  | VIN           | Power Supply |
| GPIO 25   | LRCK (WS)     | Word Select  |
| GPIO 26   | BCLK (SCK)    | Bit Clock    |
| GPIO 22   | DIN (SD)      | Data In      |

---

### Arduino Code (ESP32 C++ Sketch)

Install these libraries in your Arduino IDE before uploading:

1. `WebSocketsClient` (by Markus Sattler)
2. `ArduinoJson` (by Benoit Blanchon)
3. `ESP32-audioI2S` (by Wolle / Schreiber-Design)

```cpp
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "Audio.h"

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Node.js server configurations
const char* server_host = "YOUR_SERVER_IP"; // e.g. "192.168.1.15" or domain name
const int server_port   = 3000;

// I2S Pins for MAX98357A DAC
#define I2S_LRC     25
#define I2S_BCLK    26
#define I2S_DOUT    22

// ─── INSTANCES ───────────────────────────────────────────────────────────────
WebSocketsClient webSocket;
Audio audio;
bool isPlaying = false;

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
                    // Start playing the audio stream
                    audio.connecttohost(audio_url);
                    isPlaying = true;
                }
            }
            // 2. Handle Queue Reset Event
            else if (strcmp(event, "queue_reset") == 0) {
                Serial.println("[Audio] Reset command received. Stopping playback.");
                if (isPlaying) {
                    audio.stopPlayback();
                    isPlaying = false;
                }
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

    // Connect to WiFi
    WiFi.begin(ssid, password);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    // Initialize I2S Audio Module
    audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
    audio.setVolume(12); // Volume level 0 to 21

    // Initialize WebSockets Client
    webSocket.begin(server_host, server_port, "/");
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000); // Reconnect every 5s if disconnected
}

// ─── LOOP ────────────────────────────────────────────────────────────────────
void loop() {
    webSocket.loop();
    audio.loop(); // Must be called frequently to run non-blocking audio calculations
}

// Optional callback functions triggered by audio library
void audio_eof_mp3(const char *info){  // Triggered when audio finishes playing
    Serial.printf("Finished playing: %s\n", info);
    isPlaying = false;
}
```

---

## Part 3: Production Network Routing (Nginx Reverse Proxy)

If you are hosting the backend on a remote VPS, it is best practice to run it behind an Nginx reverse proxy with SSL (`wss://` and `https://`).

### Nginx Site Configuration

Create an Nginx configuration file:

```bash
sudo nano /etc/nginx/sites-available/assistant
```

Insert the following template (replace `yourdomain.com` with your actual domain):

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;

        # Upgrade headers to support WebSocket connections
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the configuration and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/assistant /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Secure it with SSL using Certbot:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

_(Certbot will automatically configure the SSL certificates and change port 80 to port 443 HTTPS/WSS.)_
