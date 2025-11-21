import io
import os
import time
import glob as _glob
import json
import numpy as np
from concurrent.futures import ThreadPoolExecutor
import logging

from PIL import Image, ImageEnhance
import torch
import re

# -------------------------
# 1. HEAVY MODEL LOADING
# -------------------------

# Set device (GPU if available, else CPU)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[INFO] Running on device: {DEVICE}")
logger = logging.getLogger(__name__)
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

try:
    _PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
except Exception:
    _PROJECT_ROOT = os.getcwd()

# --- A. YOLOv8 Extra Large (Highest Accuracy Pre-trained) ---
from ultralytics import YOLO
try:
    # Force download of the Extra Large model if not present
    _YOLO_MODEL_PATH = 'yolov8x.pt' 
    print(f"[INFO] Loading YOLOv8 Extra Large ({_YOLO_MODEL_PATH})...")
    yolo = YOLO(_YOLO_MODEL_PATH)
except Exception as e:
    print(f"[WARN] Failed to load YOLO model: {e}")
    yolo = None

# --- B. BLIP Captioning (Optimized for speed) ---
try:
    from transformers import BlipProcessor, BlipForConditionalGeneration
    _CAPTION_FLAVOR = os.getenv('QRECLAIM_CAPTION_MODEL', 'base').strip().lower()
    _BLIP_ID = "Salesforce/blip-image-captioning-base" if _CAPTION_FLAVOR != 'large' else "Salesforce/blip-image-captioning-large"
    print(f"[INFO] Loading BLIP Captioning model: {_BLIP_ID}")
    _dtype = torch.float16 if DEVICE == 'cuda' else torch.float32
    processor = BlipProcessor.from_pretrained(_BLIP_ID)
    blip_model = BlipForConditionalGeneration.from_pretrained(_BLIP_ID, torch_dtype=_dtype).to(DEVICE)
except Exception as e:
    print(f"[WARN] Failed to load BLIP model: {e}")
    processor = None
    blip_model = None

# --- C. CLIP (The Validator - NEW FEATURE) ---
# This is the key to fixing the "Umbrella vs Book" issue.
try:
    from transformers import CLIPProcessor, CLIPModel
    print("[INFO] Loading CLIP Large (ViT-L/14) for Zero-Shot Verification...")
    clip_model_name = "openai/clip-vit-large-patch14"
    clip_processor = CLIPProcessor.from_pretrained(clip_model_name)
    clip_model = CLIPModel.from_pretrained(clip_model_name).to(DEVICE)
except Exception as e:
    print(f"[WARN] Failed to load CLIP model: {e}")
    clip_processor = None
    clip_model = None

# --- D. VQA (Visual Question Answering) ---
try:
    from transformers import ViltProcessor, ViltForQuestionAnswering
    print("[INFO] Loading VQA model (ViLT)...")
    vqa_processor = ViltProcessor.from_pretrained("dandelin/vilt-b32-finetuned-vqa")
    vqa_model = ViltForQuestionAnswering.from_pretrained("dandelin/vilt-b32-finetuned-vqa").to(DEVICE)
except Exception as e:
    print(f"[WARN] Failed to load VQA model: {e}")
    vqa_processor = None
    vqa_model = None

# --- E. OCR (Text Recognition) ---
try:
    import easyocr
    try:
        _OCR_LANGS = ['ms', 'en']
        ocr_reader = easyocr.Reader(_OCR_LANGS)
    except Exception:
        ocr_reader = easyocr.Reader(['en'])
except Exception as e:
    print(f"[WARN] Failed to load EasyOCR: {e}")
    ocr_reader = None

try:
    import pytesseract
except Exception:
    pytesseract = None



# Load vocabulary from the predefined JSON file for better management
try:
    _VOCAB_PATH = os.path.join(_PROJECT_ROOT, 'dataset', 'predefined_vocab.json')
    with open(_VOCAB_PATH, 'r') as f:
        _VOCAB = json.load(f)
    COLORS = _VOCAB.get('colors', {})
    CLIP_CANDIDATES = _VOCAB.get('clip_candidates', [])
    VALID_TAG_CATEGORIES = {
        'colors': list(COLORS.keys()),
        'materials': _VOCAB.get('materials', []),
        'brands': _VOCAB.get('brands', [])
    }
    BRANDED_CATEGORIES = _VOCAB.get('branded_categories', [])
    print("[INFO] Successfully loaded vocabulary from JSON.")
except Exception as e:
    print(f"[WARN] Failed to load vocabulary from JSON, falling back to defaults: {e}")
    # Fallback defaults in case the JSON is missing or corrupted
    COLORS = {}
    CLIP_CANDIDATES = []
    VALID_TAG_CATEGORIES = {'colors': [], 'materials': [], 'brands': []}

# -------------------------
# Utilities
# -------------------------
def validate_and_convert_image(image_data):
    if isinstance(image_data, str):
        pil_img = Image.open(image_data)
    else:
        pil_img = Image.open(io.BytesIO(image_data))
    if pil_img.mode != 'RGB':
        pil_img = pil_img.convert('RGB')
    return pil_img

def enhance_image_for_ocr(pil_img):
    # Increase contrast slightly for better feature detection
    enhancer = ImageEnhance.Contrast(pil_img)
    return enhancer.enhance(1.5)

def run_ocr(pil_img):
    texts = []
    try:
        if ocr_reader is not None:
            res = ocr_reader.readtext(np.array(pil_img))
            for r in res:
                if isinstance(r, (list, tuple)) and len(r) >= 2:
                    t = str(r[1]).strip()
                    if t:
                        texts.append(t)
    except Exception:
        pass
    if not texts and pytesseract is not None:
        try:
            t = pytesseract.image_to_string(pil_img)
            if t:
                texts.append(t)
        except Exception:
            pass
    return texts

def interpret_ocr(texts):
    blob = " ".join(texts).lower()
    result = {"tags": set(), "brand": None, "primary": None, "confidence": 0.0}

    if not blob:
        return result

    if re.search(r"\bmykad\b", blob) or re.search(r"\bjabatan pendaftaran negara\b", blob) or re.search(r"\bmalaysia\b", blob) or re.search(r"\b\d{6}-\d{2}-\d{4}\b", blob):
        result["primary"] = "MyKad"
        result["brand"] = "JPN Malaysia"
        result["tags"].update({"MyKad", "IC", "card"})
        result["confidence"] = 0.9
        return result

    if re.search(r"\bmykid\b", blob):
        result["primary"] = "MyKid"
        result["brand"] = "JPN Malaysia"
        result["tags"].update({"MyKid", "IC", "card"})
        result["confidence"] = 0.85
        return result

    if re.search(r"\bmypr\b", blob):
        result["primary"] = "MyPR"
        result["brand"] = "JPN Malaysia"
        result["tags"].update({"MyPR", "IC", "card"})
        result["confidence"] = 0.85
        return result

    if re.search(r"\bmytentera\b", blob):
        result["primary"] = "MyTentera"
        result["brand"] = "JPN Malaysia"
        result["tags"].update({"MyTentera", "IC", "card"})
        result["confidence"] = 0.85
        return result

    if re.search(r"\brapid\s*kl\b", blob) or re.search(r"\bmyrapid\b", blob):
        result["primary"] = "Rapid KL card"
        result["brand"] = "Rapid KL"
        result["tags"].update({"transit card", "Rapid KL", "card"})
        result["confidence"] = 0.8
        return result

    if re.search(r"touch\s*n\s*go", blob) or re.search(r"\btng\b", blob):
        result["primary"] = "Touch 'n Go card"
        result["brand"] = "Touch 'n Go"
        result["tags"].update({"Touch 'n Go", "card"})
        result["confidence"] = 0.85
        return result

    if re.search(r"\btar\s*umt\b|\btar\s*uc\b|\buniversiti\b|\busm\b|\bum\b|\butm\b|\bukm\b|\bupm\b|\bsunway\b|\btaylor\b|\bmonash\b|\bucsi\b", blob):
        result["primary"] = "Student ID"
        result["tags"].update({"student ID", "card"})
        result["confidence"] = 0.8
        return result

    if re.search(r"\bmaybank\b|\bcimb\b|\brhb\b|\bpublic\s*bank\b|\bhong\s*leong\b", blob):
        result["primary"] = "Bank card"
        result["tags"].update({"bank card", "card"})
        result["confidence"] = 0.75
        return result

    return result

# -------------------------
# Analysis Functions
# -------------------------

def analyze_dominant_colors_pil(pil_img, num_colors=2):
    # (Kept similar but simplified for speed)
    try:
        img = pil_img.resize((100, 100))
        img_array = np.array(img).reshape(-1, 3)
        from sklearn.cluster import KMeans
        kmeans = KMeans(n_clusters=num_colors, n_init=5)
        kmeans.fit(img_array)
        dominant_rgbs = kmeans.cluster_centers_.astype(int)
        
        found_colors = set()
        for rgb in dominant_rgbs:
            best_color = "gray"
            min_dist = float('inf')
            for name, val in COLORS.items():
                dist = np.linalg.norm(np.array(rgb) - np.array(val))
                if dist < min_dist:
                    min_dist = dist
                    best_color = name
            found_colors.add(best_color)
        return list(found_colors)
    except:
        return []

def ask_vqa(pil_img, question):
    """
    Asks the ViLT model a specific question about the image.
    """
    if vqa_model is None:
        return None
    try:
        # Prepare inputs
        encoding = vqa_processor(pil_img, question, return_tensors="pt").to(DEVICE)
        # Forward pass
        with torch.no_grad():
            outputs = vqa_model(**encoding)
        # Get answer
        logits = outputs.logits
        idx = logits.argmax(-1).item()
        answer = vqa_model.config.id2label[idx]
        return answer
    except Exception as e:
        print(f"[VQA Error] {e}")
        return None

def get_brand_with_clip(pil_img, brand_candidates, threshold=0.25, debug=False):
    """
    Uses CLIP to identify a brand logo from a cropped image.
    This is more reliable than VQA for specific brand names.
    """
    if clip_model is None or not brand_candidates:
        return None
    
    try:
        # Formulate text inputs as "a logo of [brand]" for better context
        text_inputs = [f"a logo of {brand}" for brand in brand_candidates]
        
        inputs = clip_processor(text=text_inputs, images=pil_img, return_tensors="pt", padding=True).to(DEVICE)
        
        with torch.no_grad():
            outputs = clip_model(**inputs)
        
        probs = outputs.logits_per_image.softmax(dim=1)
        if debug:
            vals, idxs = probs[0].topk(min(5, len(brand_candidates)))
            try:
                print("[BRAND DEBUG] Top candidates:")
                for i in range(len(idxs)):
                    b = brand_candidates[idxs[i].item()] if idxs[i].item() < len(brand_candidates) else str(idxs[i].item())
                    print(f"  {b}: {vals[i].item():.3f}")
            except Exception:
                pass
        top_prob, top_idx = probs[0].topk(1)
        if top_prob.item() > threshold:
            return brand_candidates[top_idx.item()]
        return None
    except Exception as e:
        print(f"[CLIP Brand] Error: {e}")
        return None

def get_clip_classification(pil_img, candidates=CLIP_CANDIDATES):
    if clip_model is None:
        return None, 0.0
    try:
        text_inputs = [f"a photo of a {c}" for c in candidates]
        inputs = clip_processor(text=text_inputs, images=pil_img, return_tensors="pt", padding=True).to(DEVICE)
        with torch.no_grad():
            outputs = clip_model(**inputs)
        probs = outputs.logits_per_image.softmax(dim=1)
        top_prob, top_idx = probs[0].topk(1)
        return candidates[top_idx.item()], top_prob.item()
    except:
        return None, 0.0

def detect_objects_yolo(image_path):
    """
    Runs YOLOv8x detection.
    """
    if yolo is None: 
        return None
    
    try:
        # Run inference with a slightly lower threshold to catch more, then filter
        results = yolo(image_path, conf=0.25, verbose=False)
        
        best_obj = None
        max_conf = 0.0
        
        for r in results:
            for box in r.boxes:
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                name = r.names[cls_id]
                
                # We prioritize the object with the highest confidence
                if conf > max_conf:
                    max_conf = conf
                    best_obj = {
                        "name": name,
                        "conf": conf,
                        "xyxy": box.xyxy[0].cpu().numpy()
                    }
        return best_obj
    except Exception as e:
        print(f"[YOLO] Error: {e}")
        return None

def generate_caption(pil_img):
    if processor is None:
        return ""
    try:
        inputs = processor(pil_img, return_tensors="pt").to(DEVICE)
        with torch.inference_mode():
            out = blip_model.generate(
                **inputs,
                max_length=30,
                min_length=5,
                num_beams=1,
                do_sample=True,
                top_p=0.9
            )
        return processor.decode(out[0], skip_special_tokens=True)
    except Exception as e:
        try:
            logger.error(f"Caption generation failure: {e}")
        except Exception:
            pass
        return ""

# -------------------------
# MAIN PIPELINE
# -------------------------

def get_image_tags(image_data, extra_candidates=None):
    """
    Main function to generate a structured dictionary of tags for a given image.
    Orchestrates YOLO, CLIP, VQA, and BLIP models.
    """
    start_time = time.time()
    result = {
        "primary_object": "unknown",
        "tags": set(),
        "caption": "",
        "attributes": {
            "colors": [],
            "material": None,
            "brand": None
        },
        "confidence": 0.0,
        "execution_time": 0.0
    }

    try:
        # 1. Image Validation
        pil_img = validate_and_convert_image(image_data)
        enhanced_img = enhance_image_for_ocr(pil_img)

        # 2. Primary Object Detection (YOLO + CLIP)
        yolo_obj = detect_objects_yolo(pil_img)
        
        crop_img = pil_img
        if yolo_obj:
            x1, y1, x2, y2 = map(int, yolo_obj['xyxy'])
            crop_img = pil_img.crop((x1, y1, x2, y2))
            print(f"[DEBUG] YOLO found '{yolo_obj['name']}' (conf: {yolo_obj['conf']:.2f}). Cropping for analysis.")
        else:
            print("[DEBUG] No object found by YOLO. Analyzing full image.")

        dynamic_candidates = []
        if isinstance(extra_candidates, (list, tuple)):
            dynamic_candidates = [str(x).strip().lower() for x in extra_candidates if str(x).strip()]
        base_candidates = CLIP_CANDIDATES or []
        merged_candidates = list(dict.fromkeys(dynamic_candidates + base_candidates))
        clip_label, clip_conf = get_clip_classification(crop_img, candidates=merged_candidates)

        # --- Smart Reconciliation ---
        if clip_conf > 0.3: # Trust CLIP if it's reasonably confident
            result["primary_object"] = clip_label
            result["confidence"] = clip_conf
        elif yolo_obj:
            result["primary_object"] = yolo_obj['name']
            result["confidence"] = yolo_obj['conf']
        
        main_object = result["primary_object"]
        if main_object != "unknown":
            result["tags"].add(main_object)

        # 3. Attribute Extraction (VQA & Color Analysis)
        with ThreadPoolExecutor() as executor:
            # --- VQA Questions ---
            q_color = f"What is the main color of the {main_object}?"
            q_material = f"What material is the {main_object} made of?"
            # --- Conditional Brand Detection ---
            brand = None
            try:
                should_brand = True if not BRANDED_CATEGORIES else any(cat in (main_object or "") for cat in BRANDED_CATEGORIES)
                if should_brand:
                    logo_img = crop_for_logo(crop_img, main_object)
                    br_threshold = get_brand_threshold(main_object)
                    debug_flag = bool(os.getenv('QRECLAIM_BRAND_DEBUG'))
                    future_brand = executor.submit(get_brand_with_clip, logo_img, VALID_TAG_CATEGORIES.get('brands', []), br_threshold, debug_flag)
                    brand = future_brand.result()
            except Exception:
                brand = None

            # --- Other Analysis ---
            future_colors_pil = executor.submit(analyze_dominant_colors_pil, crop_img)
            future_caption = executor.submit(generate_caption, pil_img)
            future_color_vqa = None
            future_material = None
            if vqa_model is not None:
                future_color_vqa = executor.submit(ask_vqa, crop_img, q_color)
                future_material = executor.submit(ask_vqa, crop_img, q_material)

            # --- Collect Results ---
            vqa_color = None
            try:
                if future_color_vqa:
                    vqa_color = future_color_vqa.result()
            except Exception as e:
                logger.error(f"VQA color error: {e}")
            if vqa_color and vqa_color not in ["white", "black", "gray"]: # VQA can be generic
                result["attributes"]["colors"].append(vqa_color)
                result["tags"].add(vqa_color)

            material = None
            try:
                if future_material:
                    material = future_material.result()
            except Exception as e:
                logger.error(f"VQA material error: {e}")
            if material and "not sure" not in material:
                result["attributes"]["material"] = material
                result["tags"].add(material)

            if brand:
                result["attributes"]["brand"] = brand
                result["tags"].add(brand)

            dominant_colors = future_colors_pil.result()
            result["attributes"]["colors"].extend(dominant_colors)
            result["tags"].update(dominant_colors)
            
            result["caption"] = future_caption.result()

        ocr_texts = run_ocr(enhanced_img)
        ocr_info = interpret_ocr(ocr_texts)
        if ocr_info.get("primary"):
            result["primary_object"] = ocr_info["primary"]
            result["confidence"] = max(result["confidence"], ocr_info.get("confidence", 0.0))
        if ocr_info.get("brand"):
            result["attributes"]["brand"] = ocr_info["brand"]
            result["tags"].add(ocr_info["brand"])
        for t in ocr_info.get("tags", []):
            result["tags"].add(t)

        ordered = []
        primary = main_object if main_object and main_object != "unknown" else "unknown"
        ordered.append(primary.lower())
        others = [t.lower() for t in result["tags"] if t and t.lower() != primary.lower()]
        dedup_others = list(dict.fromkeys(others))
        max_tags = 8
        ordered.extend(dedup_others[: max(0, max_tags - len(ordered))])
        result["tags"] = ordered

    except Exception as e:
        print(f"[ERROR] Full pipeline failed: {e}")
        try:
            logger.error(f"Pipeline error: {e}")
        except Exception:
            pass
        import traceback
        traceback.print_exc()

    result["execution_time"] = time.time() - start_time
    print(f"[INFO] AI tagging finished in {result['execution_time']:.2f}s. Found: {result['primary_object']}")
    return result

def generate_caption_for_image(image_data):
    try:
        pil_img = validate_and_convert_image(image_data)
        return generate_caption(pil_img)
    except Exception as e:
        try:
            logger.error(f"Caption generation error: {e}")
        except Exception:
            pass
        return ""

# -------------------------
# Usage
# -------------------------
if __name__ == "__main__":
    # Example: Test with a local image file
    # Create a dummy image file for testing if it doesn't exist
    test_image_path = "test_image.jpg"
    if not os.path.exists(test_image_path):
        try:
            from PIL import Image
            dummy_img = Image.new('RGB', (600, 400), color = 'red')
            dummy_img.save(test_image_path)
            print(f"Created dummy test image at: {test_image_path}")
        except ImportError:
            print("Pillow is not installed. Cannot create a dummy image.")
            # Create an empty file as a placeholder
            with open(test_image_path, 'w') as f:
                pass


    if os.path.exists(test_image_path):
        print(f"\n--- Running test on '{test_image_path}' ---")
        tags_result = get_image_tags(test_image_path)
        print(json.dumps(tags_result, indent=2))
    else:
        print(f"Test image not found at: {test_image_path}")
def get_brand_threshold(main_object):
    m = (main_object or "").lower()
    electronics = ["mouse", "gaming mouse", "keyboard", "headphones", "earbuds", "smartphone", "mobile phone", "laptop", "macbook", "computer"]
    cards = ["card", "ic", "mykad", "mykid", "mypr", "mytentera", "access card", "student id", "matric card", "bank card", "touch 'n go", "myrapid"]
    if any(k in m for k in electronics):
        return 0.20
    if any(k in m for k in cards):
        return 0.35
    return 0.25

def crop_for_logo(img, main_object):
    try:
        w, h = img.size
        m = (main_object or "").lower()
        if "mouse" in m:
            cw = int(w * 0.6)
            ch = int(h * 0.5)
            left = (w - cw) // 2
            top = 0
            return img.crop((left, top, left + cw, top + ch))
    except Exception:
        pass
    return img
