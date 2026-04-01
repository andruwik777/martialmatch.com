"""Generate test fixture HTML/JSON under data/. Run: python server/test-martialmatch/build_test_data.py"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
SRC = REPO / "research" / "html.starting.list"
EVENTS_SRC = REPO / "research" / "html.pl.events"
SCHED_SRC = REPO / "research" / "json.harmonogram"
FIGHTS_SRC = REPO / "research" / "json.przebieg.walk"
DATA = ROOT / "data"

# 1-based line numbers in research/html.pl.events: inclusive block pasted into data/events.html.
# After MM changes the list page, adjust these (see README — For developers).
EVENTS_HTML_FIRST_LINE = 326
EVENTS_HTML_LAST_LINE = 625  # inclusive last line; slice uses [FIRST-1 : LAST] (end exclusive)

EMPTY_SCHEDULES = '{"activeScheduleId":0,"schedules":[]}'
EMPTY_FIGHTS = '{"fightQueueStatuses":{},"result":[]}'

SLUGS = {
    "full": "628-x-superpuchar-polski-bjj-nogi-gi",
    "partial_first": "707-puchar-polski-poludniowej-adcc",
    "partial_last": "723-grand-prix-polski-combat-ju-jutsu-",
    "empty_list": "703-puchar-polski-seniorow-juniorow-i-juniorow-mlodszych-w-grappling",
}


def extract_competitor_rows(html: str) -> list[tuple[int, int]]:
    rows = []
    i = 0
    while True:
        start = html.find("<tr", i)
        if start == -1:
            break
        end = html.find("</tr>", start)
        if end == -1:
            break
        block = html[start : end + 5]
        if "competitor-name" in block and "data-publicid" in block:
            rows.append((start, end + 5))
        i = end + 5
    return rows


def filter_rows(html: str, keep) -> str:
    rows = extract_competitor_rows(html)
    out = html
    for j in range(len(rows) - 1, -1, -1):
        if not keep(j, len(rows)):
            start, end = rows[j]
            out = out[:start] + out[end:]
    return out


def main() -> None:
    html = SRC.read_text(encoding="utf8")
    rows = extract_competitor_rows(html)
    n = len(rows)
    first_two_thirds = (n * 2 + 2) // 3
    last_start = n // 3
    print("Competitor rows:", n, "first 2/3:", first_two_thirds, "last 2/3 from idx:", last_start)

    for slug in SLUGS.values():
        (DATA / slug).mkdir(parents=True, exist_ok=True)

    shutil.copyfile(SRC, DATA / SLUGS["full"] / "starting-lists.html")

    (DATA / SLUGS["partial_first"] / "starting-lists.html").write_text(
        filter_rows(html, lambda j, _: j < first_two_thirds), encoding="utf8"
    )
    (DATA / SLUGS["partial_last"] / "starting-lists.html").write_text(
        filter_rows(html, lambda j, _: j >= last_start), encoding="utf8"
    )
    (DATA / SLUGS["empty_list"] / "starting-lists.html").write_text(
        filter_rows(html, lambda *_: False), encoding="utf8"
    )

    shutil.copyfile(SCHED_SRC, DATA / SLUGS["full"] / "schedules.json")
    shutil.copyfile(FIGHTS_SRC, DATA / SLUGS["full"] / "fights.json")

    shutil.copyfile(SCHED_SRC, DATA / SLUGS["partial_first"] / "schedules.json")
    (DATA / SLUGS["partial_first"] / "fights.json").write_text(
        EMPTY_FIGHTS, encoding="utf8"
    )

    for slug in (SLUGS["partial_last"], SLUGS["empty_list"]):
        (DATA / slug / "schedules.json").write_text(EMPTY_SCHEDULES, encoding="utf8")
        (DATA / slug / "fights.json").write_text(EMPTY_FIGHTS, encoding="utf8")

    elines = EVENTS_SRC.read_text(encoding="utf8").splitlines(keepends=True)
    body = "".join(elines[EVENTS_HTML_FIRST_LINE - 1 : EVENTS_HTML_LAST_LINE])
    events_html = (
        "<!DOCTYPE html>\n<html lang=\"pl\">\n<head>"
        '<meta charset="utf-8">\n<title>Test — events</title>\n</head>\n<body>\n'
        + body
        + "\n</body>\n</html>\n"
    )
    (DATA / "events.html").write_text(events_html, encoding="utf8")

    print("Wrote schedules.json / fights.json / events.html")
    print("Done.")


if __name__ == "__main__":
    main()
