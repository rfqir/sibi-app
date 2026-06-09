from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import base64
import numpy as np
import cv2
import io
from PIL import Image
from ultralytics import YOLO
import json
import os

app = FastAPI(title="SIBI Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model
MODEL_PATH = os.getenv("MODEL_PATH", "best.pt")
model = None

def get_model():
    global model
    if model is None:
        model = YOLO(MODEL_PATH)
    return model

def decode_image(data_url: str) -> np.ndarray:
    header, encoded = data_url.split(",", 1)
    img_bytes = base64.b64decode(encoded)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

def run_inference(frame: np.ndarray):
    m = get_model()
    results = m(frame, verbose=False)[0]
    detections = []
    h, w = frame.shape[:2]

    for box in results.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        label = m.names[cls_id]
        detections.append({
            "label": label,
            "confidence": round(conf, 3),
            "bbox": {
                "x": x1 / w,
                "y": y1 / h,
                "w": (x2 - x1) / w,
                "h": (y2 - y1) / h,
            }
        })
    return detections

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_PATH}

@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    contents = await file.read()
    img = Image.open(io.BytesIO(contents)).convert("RGB")
    frame = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    detections = run_inference(frame)
    return JSONResponse({"detections": detections})

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ Client connected")
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "frame":
                try:
                    frame = decode_image(msg["image"])
                    detections = run_inference(frame)
                    await websocket.send_text(json.dumps({
                        "type": "detections",
                        "detections": detections
                    }))
                except Exception as inner_e:
                    print(f"❌ Frame error: {inner_e}")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": str(inner_e)
                    }))
    except WebSocketDisconnect:
        print("🔌 Client disconnected")
    except Exception as e:
        print(f"❌ WS error: {e}")