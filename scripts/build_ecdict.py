import argparse
import csv
import hashlib
import json
import re
from pathlib import Path


WORD_PATTERN = re.compile(r"^[a-z][a-z'-]*$")


def integer(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def score(row):
    value = 0
    if row.get("translation", "").strip():
        value += 100
    if row.get("tag", "").strip():
        value += 40
    if integer(row.get("collins")) > 0:
        value += 30 + integer(row.get("collins"))
    if integer(row.get("oxford")) > 0:
        value += 30
    bnc = integer(row.get("bnc"))
    frq = integer(row.get("frq"))
    if bnc > 0:
        value += max(0, 25 - bnc // 2000)
    if frq > 0:
        value += max(0, 25 - frq // 2000)
    word = (row.get("word") or "").strip()
    value += max(0, 18 - len(word))
    return value


def clean_text(value):
    return " ".join((value or "").replace("\\n", " ").split())


def build(input_path, output_dir, limit):
    candidates = []
    with input_path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        for row in reader:
            word = (row.get("word") or "").strip().lower()
            translation = clean_text(row.get("translation"))
            if not WORD_PATTERN.fullmatch(word) or not translation:
                continue
            tie_breaker = hashlib.sha1(word.encode("utf-8")).hexdigest()
            candidates.append((score(row), tie_breaker, word, row))

    candidates.sort(key=lambda item: (-item[0], item[1]))
    selected = candidates[:limit]
    shards = {letter: {} for letter in "abcdefghijklmnopqrstuvwxyz"}
    shards["_"] = {}
    forms = {}

    for _, _, word, row in selected:
        key = word[0] if word[0] in shards else "_"
        shards[key][word] = [
            clean_text(row.get("phonetic")),
            clean_text(row.get("pos")),
            clean_text(row.get("translation")),
        ]
        exchange = clean_text(row.get("exchange"))
        for chunk in exchange.split("/"):
            if ":" not in chunk:
                continue
            _, values = chunk.split(":", 1)
            for form in values.split(","):
                form = form.strip().lower()
                if WORD_PATTERN.fullmatch(form) and form != word:
                    forms.setdefault(form, word)

    output_dir.mkdir(parents=True, exist_ok=True)
    for key, data in shards.items():
        path = output_dir / f"{key}.json"
        path.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    (output_dir / "forms.json").write_text(
        json.dumps(forms, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Built {len(selected)} entries and {len(forms)} forms into {output_dir}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--limit", type=int, default=80000)
    args = parser.parse_args()
    build(args.input, args.output, args.limit)


if __name__ == "__main__":
    main()
