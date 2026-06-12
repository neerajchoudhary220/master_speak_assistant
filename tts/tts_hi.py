from piper import PiperVoice
import wave
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

model_path = os.path.join(
    BASE_DIR,
    "models",
    "hi_IN-priyamvada-medium.onnx"
)

text = sys.argv[1]

voice = PiperVoice.load(model_path)

output_path = sys.argv[2] if len(sys.argv) > 2 else "output_hi.wav"
with wave.open(output_path, "wb") as wav_file:
    voice.synthesize_wav(text, wav_file)

print("Audio generated")