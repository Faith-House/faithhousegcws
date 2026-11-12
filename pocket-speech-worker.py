"""Offline-only Pocket TTS worker; stdin/stdout carry bounded JSON messages."""
import os
from pathlib import Path
import sys
import json
import base64
import io
import wave
import contextlib
import time

root = Path(__file__).resolve().parent
os.environ["HF_HOME"] = str(root / "models" / "pocket" / "cache")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ["OMP_NUM_THREADS"] = "2"
import socket
def offline(*args, **kwargs):
    raise RuntimeError("Speech runtime has no network access.")
socket.create_connection = offline
socket.socket.connect = offline
socket.socket.connect_ex = offline

model = None
states = {}
allowed = {"pocket_charles": "charles", "pocket_peter": "peter_yearsley"}
for line in sys.stdin:
    job = {}
    try:
        if len(line) > 20000:
            raise ValueError("Speech request too large.")
        job = json.loads(line)
        if not isinstance(job, dict):
            job = {}
            raise ValueError("Invalid speech request.")
        voice, text = job.get("voice"), job.get("text")
        warmup = job.get("op") == "warmup"
        if voice not in allowed or (not warmup and (not isinstance(text, str) or not text.strip() or len(text) > 2400)):
            raise ValueError("Invalid speech request.")
        began = time.perf_counter()
        with contextlib.redirect_stdout(sys.stderr):
            import torch
            from pocket_tts import TTSModel
            import numpy as np
            if model is None:
                torch.set_num_threads(2)
                torch.set_num_interop_threads(1)
                model = TTSModel.load_model(language="english_2026-10")
            if voice not in states:
                states[voice] = model.get_state_for_audio_prompt(allowed[voice])
            if warmup:
                print(json.dumps({"id": job.get("id"), "type": "done", "metrics": {"warmupMs": round((time.perf_counter() - began) * 1000)}}), file=sys.__stdout__, flush=True)
                continue
            first_chunk = None
            if job.get("stream"):
                for chunk in model.generate_audio_stream(states[voice], text):
                    audio = chunk.detach().cpu().numpy().reshape(-1)
                    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
                    if not pcm:
                        continue
                    if first_chunk is None:
                        first_chunk = round((time.perf_counter() - began) * 1000)
                    print(json.dumps({"id": job.get("id"), "type": "chunk", "sampleRate": model.sample_rate, "audio": base64.b64encode(pcm).decode("ascii")}), file=sys.__stdout__, flush=True)
                print(json.dumps({"id": job.get("id"), "type": "done", "metrics": {"generationMs": round((time.perf_counter() - began) * 1000), "firstChunkMs": first_chunk}}), file=sys.__stdout__, flush=True)
                continue
            audio = model.generate_audio(states[voice], text).detach().cpu().numpy()
            pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(model.sample_rate)
            wav.writeframes(pcm)
        print(json.dumps({"id": job.get("id"), "audio": base64.b64encode(output.getvalue()).decode("ascii"), "metrics": {"generationMs": round((time.perf_counter() - began) * 1000), "durationSeconds": len(audio) / model.sample_rate}}), flush=True)
    except Exception:
        print(json.dumps({"id": job.get("id"), "error": "Pocket voice could not be prepared from its local files."}), flush=True)
