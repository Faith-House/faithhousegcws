"""Download Pocket's pinned English model and two stock voice states once."""
import os
from pathlib import Path
import json
import hashlib

root = Path(__file__).resolve().parent
target = root / "models" / "pocket"
os.environ["HF_HOME"] = str(target / "cache")
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["OMP_NUM_THREADS"] = "2"
import torch
from pocket_tts import TTSModel
torch.set_num_threads(2)
torch.set_num_interop_threads(1)
print("Downloading the pinned local speech model and voice states...", flush=True)
model = TTSModel.load_model(language="english_2026-10")
for voice in ["charles", "peter_yearsley"]:
    model.get_state_for_audio_prompt(voice)
files = []
for path in sorted((target / "cache" / "hub").glob("models--*/blobs/*")):
    if not path.is_file() or path.name.endswith(".incomplete"):
        continue
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1048576), b""):
            digest.update(chunk)
    files.append({"path": str(path.relative_to(target)), "bytes": path.stat().st_size, "sha256": digest.hexdigest()})
manifest = {"engine": "pocket-tts", "version": "4.0.1", "language": "english_2026-10", "voices": ["charles", "peter_yearsley"], "files": files}
target.mkdir(parents=True, exist_ok=True)
(target / "jarvis-pocket-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print("Pocket voices are installed. Runtime uses cached files with network access blocked.", flush=True)
