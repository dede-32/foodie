import csv
import json
import re
import unicodedata
from pathlib import Path
from PIL import Image, ImageOps
import smartcrop

INPUT_FILE = "tools/foods.csv"
OUTPUT_FILE = "foods.json"

# Složky pro automatické zpracování obrázků
RAW_IMG_DIR = Path("images/raw")
OUT_IMG_DIR = Path("images/foods")


def slugify(text: str) -> str:
    """Convert text to a simple ASCII slug."""
    text = text.strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "item"


def split_pipe_list(value: str) -> list[str]:
    """Split values like 'a|b|c' into a clean list."""
    if not value:
        return []
    return [item.strip() for item in value.split("|") if item.strip()]


def to_int(value: str, default: int) -> int:
    """Convert string to int safely."""
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return default


def detect_dialect(file_path: Path) -> csv.Dialect:
    """Try to detect CSV delimiter automatically."""
    sample = file_path.read_text(encoding="utf-8-sig")[:4096]
    try:
        # Přidáno i svislítko '|' pro případ, že ho používáš i na oddělování sloupců
        return csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        # Fallback to comma
        class SimpleDialect(csv.Dialect):
            delimiter = ","
            quotechar = '"'
            doublequote = True
            skipinitialspace = True
            lineterminator = "\n"
            quoting = csv.QUOTE_MINIMAL
        return SimpleDialect


def process_image(food_id: str) -> bool:
    """Najde původní fotku, CHYTŘE ji ořízne na 4:3, zmenší a uloží jako WebP."""
    RAW_IMG_DIR.mkdir(parents=True, exist_ok=True)
    OUT_IMG_DIR.mkdir(parents=True, exist_ok=True)

    # Zkusíme najít obrázek
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".JPG", ".JPEG", ".PNG"]:
        raw_path = RAW_IMG_DIR / f"{food_id}{ext}"
        if raw_path.exists():
            try:
                # Načteme obrázek pomocí Pillow
                img = Image.open(raw_path)
                # Převedeme na RGB, pokud má náhodou průhlednost
                if img.mode != 'RGB':
                    img = img.convert("RGB")
                
                # Cílové rozměry a poměr (800 x 600) pro 4:3
                target_width = 800
                target_height = 600

                # --- CHYTRÝ OŘEZ POMOCÍ SMARTCROP ---
                # Inicializace cropperu
                sc = smartcrop.SmartCrop()
                
                # Získáme ty nejlepší souřadnice pro náš cílový ořez
                # smartcrop nám vrátí slovník s informacemi, kde to jídlo na fotce asi je
                result = sc.crop(img, width=target_width, height=target_height)
                
                # Vyndáme z toho ten konkrétní rámeček
                box = (
                    result['top_crop']['x'],
                    result['top_crop']['y'],
                    result['top_crop']['x'] + result['top_crop']['width'],
                    result['top_crop']['y'] + result['top_crop']['height']
                )

                # Ořízneme přesně tu zajímavou část, kterou smartcrop našel
                cropped_img = img.crop(box)

                # Zmenšíme ho na naši finální velikost
                # Používáme LANCZOS pro nejvyšší možnou kvalitu zmenšování
                cropped_img.thumbnail((target_width, target_height), Image.Resampling.LANCZOS)
                
                # Uložíme krásný výsledek ve formátu WebP
                out_path = OUT_IMG_DIR / f"{food_id}.webp"
                cropped_img.save(out_path, "WEBP", quality=80)
                
                print(f"  [+] Chytře oříznuto a uloženo: {out_path.name}")
                return True
            except Exception as e:
                print(f"  [!] Chyba při zpracování obrázku {raw_path.name}: {e}")
    return False


def main():
    input_path = Path(INPUT_FILE)
    output_path = Path(OUTPUT_FILE)

    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    # Robustní detekce oddělovačů zůstává
    dialect = detect_dialect(input_path)

    foods = []
    used_ids = set()

    with input_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, dialect=dialect)

        # Kontrola povinných sloupců (img zde není, řeší se samo přes ID)
        required_columns = {
            "name",
            "meal_type",
            "time_min",
            "methods",
            "ingredients",
            "tags",
            "weight",
        }

        if reader.fieldnames is None:
            raise ValueError("CSV file has no header row.")

        missing = required_columns - set(reader.fieldnames)
        if missing:
            raise ValueError(f"Missing columns in CSV: {', '.join(sorted(missing))}")

        for row_num, row in enumerate(reader, start=2):
            name = (row.get("name") or "").strip()
            if not name:
                print(f"Skipping row {row_num}: empty name")
                continue

            # Generování bezpečného ID pro HTML a název fotky
            base_id = slugify(name)
            unique_id = base_id
            counter = 2
            while unique_id in used_ids:
                unique_id = f"{base_id}-{counter}"
                counter += 1
            used_ids.add(unique_id)

            # --- MAGIE ZDE: Zkusí najít a oříznout fotku ---
            process_image(unique_id)

            food = {
                "id": unique_id,
                "name": name,
                "img": f"images/foods/{unique_id}.webp", # Odkazujeme rovnou na optimalizovaný formát
                "meal_type": split_pipe_list(row.get("meal_type", "")),
                "time_category": (row.get("time_min") or "").strip(),                
                "methods": split_pipe_list(row.get("methods", "")),
                "ingredients": split_pipe_list(row.get("ingredients", "")),
                "tags": split_pipe_list(row.get("tags", "")),
                "weight": to_int(row.get("weight", ""), 1),
            }

            foods.append(food)

    output = {
        "version": 1,
        "foods": foods,
    }

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nHotovo! {len(foods)} jídel úspěšně uloženo do {output_path}.")


if __name__ == "__main__":
    main()