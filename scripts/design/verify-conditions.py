#!/usr/bin/env python3
"""test/design/*.toml の条件書を機械検証する。

検証内容（test-structure skill §4 準拠）:
  (a) [covers:<id>] タグが実在する条件idを指しているか（dangling tag検出）
  (b) 全条件が少なくとも1つのタグでcoverされているか（網羅検査）
  (c) conditions.tomlのschema健全性（id形式・必須フィールド・expect_*・id一意性）
  (d) source_lines をタグ走査結果へ自動同期してtomlへ書き戻す
  (e) [[excluded]] の item/source/reason が空でないか

機械検証のpassは内容の正当性・網羅性の証明ではない。出典×条件の内容照合は
test-structure skill §5「検証」に従い人間/レビューが別途行う。
"""

from __future__ import annotations

import argparse
import glob
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

ID_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$")
COVERS_TAG_PATTERN = re.compile(
    r"\[covers:([a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*)\]"
)
EXPECT_KEYS = ("expect_return", "expect_return_shape", "expect_throw", "expect_no_throw")
REQUIRED_CONDITION_FIELDS = ("target_function", "description", "given")
REQUIRED_EXCLUDED_FIELDS = ("item", "source", "reason")

TOP_LEVEL_HEADER = re.compile(r"^(\[\[?[A-Za-z_]+\]\]?)\s*$", re.MULTILINE)


@dataclass
class Finding:
    level: str  # "FAIL" or "WARN"
    check: str  # "a" .. "e"
    message: str


@dataclass
class TagRef:
    id: str
    file: str
    line: int


@dataclass
class TomlDoc:
    path: Path
    text: str
    data: dict
    conditions: list[dict] = field(default_factory=list)
    excluded: list[dict] = field(default_factory=list)


def load_toml_docs(pattern: str) -> list[TomlDoc]:
    docs = []
    for path_str in sorted(glob.glob(pattern)):
        path = Path(path_str)
        text = path.read_text(encoding="utf-8")
        with path.open("rb") as f:
            data = tomllib.load(f)
        doc = TomlDoc(
            path=path,
            text=text,
            data=data,
            conditions=data.get("condition", []),
            excluded=data.get("excluded", []),
        )
        docs.append(doc)
    return docs


def scan_covers_tags(test_glob: str) -> list[TagRef]:
    refs = []
    for path_str in sorted(glob.glob(test_glob, recursive=True)):
        path = Path(path_str)
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for lineno, line in enumerate(lines, start=1):
            for m in COVERS_TAG_PATTERN.finditer(line):
                refs.append(TagRef(id=m.group(1), file=str(path), line=lineno))
    return refs


def check_schema(doc: TomlDoc, all_ids_seen: dict[str, str], strict_source: bool) -> list[Finding]:
    findings = []

    if "feature" not in doc.data.get("meta", {}) or not doc.data["meta"].get("feature"):
        findings.append(Finding("FAIL", "c", f"{doc.path}: [meta].feature が空です"))
    if "source_file" not in doc.data.get("meta", {}) or not doc.data["meta"].get("source_file"):
        findings.append(Finding("FAIL", "c", f"{doc.path}: [meta].source_file が空です"))

    for cond in doc.conditions:
        cid = cond.get("id", "")
        loc = f"{doc.path}#{cid or '(id欠落)'}"

        if not cid:
            findings.append(Finding("FAIL", "c", f"{loc}: id が空です"))
        elif not ID_PATTERN.match(cid):
            findings.append(
                Finding(
                    "FAIL",
                    "c",
                    f"{loc}: id '{cid}' が <area>.<kebab-topic> 形式に一致しません",
                )
            )
        if cid:
            if cid in all_ids_seen:
                findings.append(
                    Finding(
                        "FAIL",
                        "c",
                        f"{loc}: id '{cid}' が {all_ids_seen[cid]} と重複しています",
                    )
                )
            else:
                all_ids_seen[cid] = str(doc.path)

        for field_name in REQUIRED_CONDITION_FIELDS:
            if not str(cond.get(field_name, "")).strip():
                findings.append(Finding("FAIL", "c", f"{loc}: 必須フィールド '{field_name}' が空です"))

        source_val = str(cond.get("source", "")).strip()
        if not source_val:
            level = "FAIL" if strict_source else "WARN"
            findings.append(Finding(level, "c", f"{loc}: source が空です（--strict-sourceで必須化）"))

        # bool型のexpect_no_throw/expect_throwもstr()化して判定に含まれる（Trueは"True"で有効値扱い）
        has_expect = any(
            key in cond and str(cond[key]).strip() not in ("", "False", "false")
            for key in EXPECT_KEYS
            if key in cond
        )
        if not has_expect:
            findings.append(
                Finding(
                    "FAIL",
                    "c",
                    f"{loc}: expect_return / expect_return_shape / expect_throw / expect_no_throw "
                    "のいずれも設定されていません",
                )
            )

        if "verified" in cond and cond["verified"] is False and not str(
            cond.get("unverifiable_reason", "")
        ).strip():
            findings.append(
                Finding("FAIL", "c", f"{loc}: verified=false の場合 unverifiable_reason が必須です")
            )

    for i, exc in enumerate(doc.excluded):
        loc = f"{doc.path}#excluded[{i}]"
        for field_name in REQUIRED_EXCLUDED_FIELDS:
            if not str(exc.get(field_name, "")).strip():
                findings.append(Finding("FAIL", "e", f"{loc}: 必須フィールド '{field_name}' が空です"))

    return findings


def check_coverage_and_dangling(
    doc: TomlDoc, tag_refs: list[TagRef]
) -> tuple[list[Finding], dict[str, list[TagRef]]]:
    findings = []
    condition_ids = {c["id"] for c in doc.conditions if c.get("id")}
    refs_by_id: dict[str, list[TagRef]] = {}
    for ref in tag_refs:
        refs_by_id.setdefault(ref.id, []).append(ref)

    # (a) dangling tag: このdocの条件ではないが、他のdocにも無い場合のみここでは判定しない。
    # dangling判定は全doc横断のid集合と照合するため呼び出し側でまとめて行う。

    # (b) 網羅検査
    for cid in sorted(condition_ids):
        if cid not in refs_by_id:
            findings.append(
                Finding("FAIL", "b", f"{doc.path}#{cid}: どのテストの [covers:{cid}] タグからも参照されていません")
            )

    return findings, refs_by_id


def sync_source_lines(doc: TomlDoc, refs_by_id: dict[str, list[TagRef]]) -> bool:
    """(d) source_lines をtag走査結果へ同期し、変更があればファイルへ書き戻す。"""
    segments = []
    matches = list(TOP_LEVEL_HEADER.finditer(doc.text))
    if not matches:
        return False

    preamble = doc.text[: matches[0].start()]
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(doc.text)
        segments.append([m.group(1), doc.text[start:end]])

    changed = False
    for seg in segments:
        header, body = seg
        if header != "[[condition]]":
            continue
        id_match = re.search(r'^id\s*=\s*"([^"]*)"\s*$', body, re.MULTILINE)
        if not id_match:
            continue
        cid = id_match.group(1)
        refs = refs_by_id.get(cid, [])
        if not refs:
            new_value = ""
        else:
            new_value = ", ".join(f"{r.file}:{r.line}" for r in refs)

        existing_match = re.search(r'^source_lines\s*=\s*"([^"]*)"\s*$', body, re.MULTILINE)
        if existing_match:
            if existing_match.group(1) != new_value:
                if new_value:
                    new_line = f'source_lines = "{new_value}"'
                    seg[1] = (
                        body[: existing_match.start()]
                        + new_line
                        + body[existing_match.end() :]
                    )
                else:
                    # タグが1つも無くなった場合は行ごと削除する
                    line_start = body.rfind("\n", 0, existing_match.start()) + 1
                    line_end = body.find("\n", existing_match.end())
                    line_end = line_end + 1 if line_end != -1 else len(body)
                    seg[1] = body[:line_start] + body[line_end:]
                changed = True
        elif new_value:
            source_match = re.search(r'^source\s*=\s*"[^"]*"\s*$', body, re.MULTILINE)
            insert_after = source_match if source_match else id_match
            insert_pos = insert_after.end()
            line_end = body.find("\n", insert_pos)
            insert_pos = line_end + 1 if line_end != -1 else len(body)
            new_line = f'source_lines = "{new_value}"\n'
            seg[1] = body[:insert_pos] + new_line + body[insert_pos:]
            changed = True

    if changed:
        new_text = preamble + "".join(seg[1] for seg in segments)
        doc.path.write_text(new_text, encoding="utf-8")

    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--glob",
        default="test/design/*.toml",
        help="検証対象のtomlファイルglob（デフォルト: test/design/*.toml）",
    )
    parser.add_argument(
        "--test-glob",
        default="test/**/*.test.ts",
        help="[covers:<id>] タグを走査するテストファイルglob",
    )
    parser.add_argument(
        "--strict-source",
        action="store_true",
        help="source欄の欠落をfailにする（全条件のsource移行完了後にon）",
    )
    parser.add_argument(
        "--no-write",
        action="store_true",
        help="source_linesの自動同期による書き戻しを行わない（差分確認のみ）",
    )
    args = parser.parse_args()

    docs = load_toml_docs(args.glob)
    if not docs:
        print(f"対象tomlが見つかりません: {args.glob}", file=sys.stderr)
        return 1

    tag_refs = scan_covers_tags(args.test_glob)

    all_findings: list[Finding] = []
    all_ids_seen: dict[str, str] = {}

    all_condition_ids: set[str] = set()
    for doc in docs:
        for c in doc.conditions:
            if c.get("id"):
                all_condition_ids.add(c["id"])

    # (a) dangling tag: 全doc横断の条件id集合に無いタグを検出
    for ref in tag_refs:
        if ref.id not in all_condition_ids:
            all_findings.append(
                Finding(
                    "FAIL",
                    "a",
                    f"{ref.file}:{ref.line}: [covers:{ref.id}] が実在する条件idを指していません（dangling tag）",
                )
            )

    refs_by_id_all: dict[str, list[TagRef]] = {}
    for ref in tag_refs:
        refs_by_id_all.setdefault(ref.id, []).append(ref)

    changed_files = []
    for doc in docs:
        all_findings.extend(check_schema(doc, all_ids_seen, args.strict_source))
        cov_findings, _ = check_coverage_and_dangling(doc, tag_refs)
        all_findings.extend(cov_findings)
        if not args.no_write:
            if sync_source_lines(doc, refs_by_id_all):
                changed_files.append(str(doc.path))

    fails = [f for f in all_findings if f.level == "FAIL"]
    warns = [f for f in all_findings if f.level == "WARN"]

    print(f"検証対象: {len(docs)} ファイル / 条件 {len(all_condition_ids)} 件 / タグ {len(tag_refs)} 件")
    if changed_files:
        print(f"source_lines を同期し書き戻しました: {', '.join(changed_files)}")

    for f in sorted(all_findings, key=lambda x: (x.level, x.check)):
        print(f"[{f.level}] ({f.check}) {f.message}")

    print()
    print(f"FAIL: {len(fails)} 件 / WARN: {len(warns)} 件")

    if fails:
        print("結果: FAIL")
        return 1

    print("結果: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
