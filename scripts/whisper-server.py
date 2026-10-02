#!/usr/bin/env python3
"""Local speech-to-text server speaking the OpenAI `/v1/audio/transcriptions` protocol.

Keeps the model loaded between requests (loading takes seconds, transcribing a voice note well under one).
Needs `pip install openai-whisper` and ffmpeg. Usage: whisper-server.py [model] [port]
"""
import json
import os
import sys
import tempfile
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

import torch
import whisper

MODEL = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("WHISPER_MODEL", "large-v3-turbo")
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.environ.get("WHISPER_PORT", "8178"))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

model = whisper.load_model(MODEL, device=DEVICE)
MAX_BODY = 100 * 1024 * 1024
lock = Lock()  # one transcription at a time: the model is not thread-safe


def parse_form(content_type: str, body: bytes) -> dict:
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\n\r\n".encode() + body
    )
    return {part.get_param("name", header="content-disposition"): part.get_payload(decode=True) for part in message.iter_parts()}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/v1/audio/transcriptions":
            return self.reply(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            return self.reply(413, {"error": "file too large"})
        body = self.rfile.read(length)
        form = parse_form(self.headers.get("Content-Type", ""), body)
        if "file" not in form:
            return self.reply(400, {"error": "missing file"})
        language = (form.get("language") or b"").decode() or None
        try:
            with tempfile.NamedTemporaryFile() as audio:
                audio.write(form["file"])
                audio.flush()
                with lock:
                    result = model.transcribe(audio.name, language=language, fp16=DEVICE == "cuda")
        except Exception as error:  # undecodable audio, out of memory...
            return self.reply(500, {"error": str(error)})
        self.reply(200, {"text": result["text"].strip(), "language": result["language"]})

    def do_GET(self) -> None:
        self.reply(200, {"ok": True, "model": MODEL, "device": DEVICE})

    def log_message(self, *_args) -> None:
        pass


print(f"whisper {MODEL} on {DEVICE}, listening on 127.0.0.1:{PORT}", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
