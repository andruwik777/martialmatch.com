"""
One-off / maintenance: build starting-lists.json (public API shape) from legacy
starting-lists.html fixtures. Stdlib only. Run from repo root:

  python server/dev-test-martialmatch-v1/convert_starting_lists_html_to_json.py
"""
from __future__ import annotations

import json
import re
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

CAT_BLOCK = re.compile(
    r'<h4 class="title is-4[^"]*"[^>]*>\s*'
    r'<a[^>]*href="[^"]*parameterId=(\d+)"[^>]*>\s*([^<]*?)\s*</a>',
    re.I | re.S,
)
COMPETITOR = re.compile(
    r'<a class="competitor-name"[^>]*data-publicid="([^"]+)"[^>]*>\s*([^<]*?)\s*</a>',
    re.I | re.S,
)
# tail starts right after competitor-name </a>; next club cell is
# </td> (close name column) then <td> (club). Do not use </a></td> — the first
# </a> in tail is often the academy link, with branch text before </td>.
NEXT_CLUB_TD = re.compile(
    r"</td>\s*<td[^>]*>(.*?)</td>",
    re.I | re.S,
)
# Club cell: <a href="/pl/academies/9">Academia Gorila</a> / Warszawa
ACADEMY_LINK = re.compile(
    r'<a[^>]+href="(?:https?://[^"]+)?/pl/academies/(\d+)"[^>]*>(.*?)</a>',
    re.I | re.S,
)


def strip_ws(s: str) -> str:
    return re.sub(r"\s+", " ", unescape(s or "")).strip()


def strip_tags(html: str) -> str:
    return strip_ws(re.sub(r"<[^>]+>", " ", html))


def parse_club_td(td_inner: str) -> tuple[str, int, str]:
    """
    academy = link text for /pl/academies/{id}
    academyId = numeric id from href (0 if no academy link)
    branch = remainder of cell after </a> (leading / stripped)
    """
    raw = (td_inner or "").strip()
    m = ACADEMY_LINK.search(raw)
    if not m:
        club = strip_tags(raw)
        if " / " in club:
            a, b = club.split(" / ", 1)
            return (a.strip() or "—", 0, b.strip())
        return (club or "—", 0, "")

    academy_id = int(m.group(1))
    academy = strip_ws(re.sub(r"<[^>]+>", " ", m.group(2)))
    tail = raw[m.end() :]
    branch = strip_ws(re.sub(r"^/\s*", "", strip_ws(tail)))
    return (academy or "—", academy_id, branch)


def html_to_public_json(html: str) -> dict:
    categories: list[dict] = []
    for m in CAT_BLOCK.finditer(html):
        pid = int(m.group(1))
        cat_name = strip_ws(m.group(2))
        start = m.end()
        nxt = CAT_BLOCK.search(html, start)
        end = nxt.start() if nxt else len(html)
        block = html[start:end]
        competitors: list[dict] = []
        for cm in COMPETITOR.finditer(block):
            public_id = cm.group(1).strip()
            full = strip_ws(cm.group(2))
            parts = full.rsplit(" ", 1)
            if len(parts) == 2 and parts[1]:
                fn, ln = parts[0], parts[1]
            else:
                fn, ln = full, ""
            tail = block[cm.end() : cm.end() + 4000]
            club_m = NEXT_CLUB_TD.search(tail)
            td_html = club_m.group(1) if club_m else ""
            academy, academy_id, branch = parse_club_td(td_html)
            competitors.append(
                {
                    "publicId": public_id,
                    "firstName": fn,
                    "lastName": ln,
                    "academy": academy or "—",
                    "academyId": academy_id,
                    "branch": branch,
                    "nationality": "PL",
                    "isDisqualifiedForNoPayment": False,
                }
            )
        categories.append(
            {
                "parameterId": pid,
                "category": cat_name,
                "competitors": competitors,
            }
        )
    return {
        "sharingType": 1,
        "lastUpdate": "2000-01-01T00:00:00+00:00",
        "categories": categories,
    }


def main() -> None:
    if not DATA.is_dir():
        raise SystemExit(f"Missing data dir: {DATA}")
    for html_path in sorted(DATA.glob("**/starting-lists.html")):
        # Snapshot 798 uses SPA shell HTML without table rows; keep hand-captured JSON.
        if html_path.parent.name.startswith("798-"):
            continue
        out_path = html_path.with_name("starting-lists.json")
        html = html_path.read_text(encoding="utf8")
        payload = html_to_public_json(html)
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf8",
        )
        n = sum(len(c["competitors"]) for c in payload["categories"])
        print(f"Wrote {out_path.relative_to(ROOT)}  ({len(payload['categories'])} categories, {n} competitors)")


if __name__ == "__main__":
    main()
