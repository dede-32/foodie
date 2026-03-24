import csv
import json
import re
import unicodedata
from pathlib import Path

INPUT_FILE = "foods.csv"
OUTPUT_FILE = "foods.json"


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
        return csv.Sniffer().sniff(sample, delimiters=",;\t")
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


def main():
    input_path = Path(INPUT_FILE)
    output_path = Path(OUTPUT_FILE)

    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    dialect = detect_dialect(input_path)

    foods = []
    used_ids = set()

    with input_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, dialect=dialect)

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

            base_id = slugify(name)
            unique_id = base_id
            counter = 2
            while unique_id in used_ids:
                unique_id = f"{base_id}-{counter}"
                counter += 1
            used_ids.add(unique_id)

            food = {
                "id": unique_id,
                "name": name,
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

    print(f"Done: {len(foods)} foods saved to {output_path}")


if __name__ == "__main__":
    main()