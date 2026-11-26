#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ดึงปริมาณงานจากโมเดล Archicad (ผ่าน JSON API ที่ Archicad เปิดไว้บน localhost)
แล้วเขียนเป็นไฟล์ CSV รูปแบบเดียวกับไฟล์ BOQ-xxxx_BOQ.csv

วิธีใช้ (เปิด Archicad พร้อมโปรเจกต์ไว้ก่อน):
    python boq_from_archicad.py                       # ใช้กฎตั้งต้น เขียน BOQ_Archicad.csv
    python boq_from_archicad.py -c boq_config.json    # ใช้กฎจากไฟล์ config
    python boq_from_archicad.py --list-properties     # ดูชื่อ property ทั้งหมดที่โปรเจกต์นี้มี

ใช้แค่ไลบรารีมาตรฐานของ Python 3.8+ ไม่ต้องติดตั้งอะไรเพิ่ม
"""
import argparse
import csv
import json
import os
import sys
import urllib.request
from collections import OrderedDict

DEFAULT_PORTS = range(19723, 19744)
BATCH = 500

# ---------------------------------------------------------------- กฎตั้งต้น
# แต่ละกฎ = หนึ่งกลุ่มรายการใน BOQ
#   category      : หมวดงาน (แถวหัวข้อ 1, 2, 3 ...)
#   element_type  : ชนิดชิ้นส่วนใน Archicad (Wall, Slab, Column, Beam, Roof, Zone,
#                   Door, Window, Object, Railing, Stair, Mesh, CurtainWall ...)
#   item          : ชื่อรายการ ใส่ {group} เพื่อแทนด้วยค่าที่จัดกลุ่ม
#   group_by      : ชื่อ built-in property หรือ "ชื่อกลุ่ม/ชื่อ property" ของ user-defined
#                   (เว้นว่าง = ไม่จัดกลุ่ม)
#   quantity      : ชื่อ built-in property ของปริมาณ หรือ "COUNT" เพื่อนับจำนวนชิ้น
#   unit          : หน่วยใน BOQ
#   factor        : ตัวคูณ (เช่น เผื่อเสีย 1.05)
#   components    : true = แยกตามชั้นวัสดุของ Composite/Profile (ผนัง พื้น หลังคา)
DEFAULT_RULES = [
    {"category": "งานโครงสร้าง", "element_type": "Column", "item": "คอนกรีตเสา",
     "quantity": "General_NetVolume", "unit": "ลบ.ม."},
    {"category": "งานโครงสร้าง", "element_type": "Beam", "item": "คอนกรีตคาน",
     "quantity": "General_NetVolume", "unit": "ลบ.ม."},
    {"category": "งานโครงสร้าง", "element_type": "Slab", "item": "คอนกรีตพื้น",
     "quantity": "General_NetVolume", "unit": "ลบ.ม."},
    {"category": "งานพื้น", "element_type": "Slab", "item": "ผิวพื้น {group}",
     "group_by": "General_BuildingMaterials", "quantity": "Slab_TopSurfaceArea", "unit": "ตร.ม."},
    {"category": "งานผนัง", "element_type": "Wall", "item": "ผนัง {group}",
     "group_by": "General_BuildingMaterials", "quantity": "Wall_NetOutsideSurfaceArea", "unit": "ตร.ม."},
    {"category": "งานผนัง", "element_type": "Wall", "item": "วัสดุผนัง {group}",
     "components": True, "quantity": "Component_NetVolume", "unit": "ลบ.ม."},
    {"category": "งานหลังคา", "element_type": "Roof", "item": "หลังคา {group}",
     "group_by": "General_BuildingMaterials", "quantity": "Roof_NetTopSurfaceArea", "unit": "ตร.ม."},
    {"category": "งานประตู-หน้าต่าง", "element_type": "Door", "item": "ประตู {group}",
     "group_by": "General_LibraryPartName", "quantity": "COUNT", "unit": "ชุด"},
    {"category": "งานประตู-หน้าต่าง", "element_type": "Window", "item": "หน้าต่าง {group}",
     "group_by": "General_LibraryPartName", "quantity": "COUNT", "unit": "ชุด"},
    {"category": "งานราวกันตก", "element_type": "Railing", "item": "ราวกันตก",
     "quantity": "Railing_ReferenceLine2DLength", "unit": "ม."},
    {"category": "พื้นที่ใช้สอย", "element_type": "Zone", "item": "พื้นที่ {group}",
     "group_by": "Zone_ZoneName", "quantity": "Zone_NetArea", "unit": "ตร.ม."},
]

HEADER = ["ลำดับ", "รายการ", "จำนวน", "หน่วย", "ราคาต่อหน่วยวัสดุ", "จำนวนเงินวัสดุ",
          "ราคาต่อหน่วยค่าแรง", "จำนวนเงินค่าแรง", "รวมเป็นเงิน", "หมายเหตุ"]


# ---------------------------------------------------------------- JSON API
class ArchicadError(Exception):
    pass


class Archicad:
    def __init__(self, port):
        self.url = "http://127.0.0.1:%d" % port

    def call(self, command, parameters=None, timeout=120):
        body = {"command": command}
        if parameters is not None:
            body["parameters"] = parameters
        req = urllib.request.Request(self.url, data=json.dumps(body).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            res = json.loads(r.read().decode("utf-8"))
        if not res.get("succeeded"):
            raise ArchicadError("%s: %s" % (command, res.get("error")))
        return res.get("result", {})


def find_archicad(port=None):
    ports = [port] if port else DEFAULT_PORTS
    for p in ports:
        try:
            ac = Archicad(p)
            ac.call("API.IsAlive", timeout=2)
            return ac, p
        except Exception:
            continue
    return None, None


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def property_ref(name):
    """'General_NetVolume' -> built-in, 'กลุ่ม/ชื่อ' -> user-defined"""
    if "/" in name:
        return {"type": "UserDefined", "localizedName": name.split("/", 1)}
    return {"type": "BuiltIn", "nonLocalizedName": name}


def resolve_property_ids(ac, names):
    """คืน dict ชื่อ -> {"guid": ...} เฉพาะที่มีจริง พร้อมรายชื่อที่หาไม่เจอ"""
    names = [n for n in OrderedDict.fromkeys(names) if n and n != "COUNT"]
    if not names:
        return {}, []
    res = ac.call("API.GetPropertyIds", {"properties": [property_ref(n) for n in names]})
    ids, missing = {}, []
    for n, item in zip(names, res.get("properties", [])):
        if "propertyId" in item:
            ids[n] = item["propertyId"]
        else:
            missing.append(n)
    return ids, missing


def to_value(pv):
    """แปลง propertyValue ของ API เป็นตัวเลขหรือข้อความ คืน None ถ้าไม่มีค่า"""
    if not pv or "propertyValue" not in pv:
        return None
    v = pv["propertyValue"]
    if v.get("status") not in (None, "normal"):
        return None
    val = v.get("value")
    if isinstance(val, dict):
        val = val.get("displayValue") or val.get("nonLocalizedValue")
    elif isinstance(val, list):
        parts = []
        for x in val:
            parts.append(x.get("displayValue") or x.get("nonLocalizedValue") if isinstance(x, dict) else x)
        val = ", ".join(str(p) for p in parts if p not in (None, ""))
    return val


def get_values(ac, elements, prop_ids, components=False):
    """คืน list ของ list ค่า ตามลำดับ elements x prop_ids"""
    out = []
    props = [{"propertyId": g} for g in prop_ids]
    for part in chunks(elements, BATCH):
        if components:
            res = ac.call("API.GetPropertyValuesOfElementComponents",
                          {"elementComponents": part, "properties": props})
            rows = res.get("propertyValuesForElementComponents", [])
        else:
            res = ac.call("API.GetPropertyValuesOfElements", {"elements": part, "properties": props})
            rows = res.get("propertyValuesForElements", [])
        for row in rows:
            vals = row.get("propertyValues") if isinstance(row, dict) else None
            out.append([to_value(v) for v in vals] if vals else [None] * len(props))
    return out


def get_components(ac, elements):
    comps = []
    for part in chunks(elements, BATCH):
        res = ac.call("API.GetComponentsOfElements", {"elements": part})
        for item in res.get("componentsOfElements", []):
            comps.extend(item.get("elementComponents", []))
    return comps


# ---------------------------------------------------------------- คำนวณ BOQ
def run_rule(ac, rule, warnings):
    etype = rule["element_type"]
    elements = ac.call("API.GetElementsByType", {"elementType": etype}).get("elements", [])
    if not elements:
        return []
    qty_name = rule.get("quantity", "COUNT")
    use_comp = bool(rule.get("components"))
    group_name = rule.get("group_by") or ("BuildingMaterial_Name" if use_comp else "")
    factor = float(rule.get("factor", 1))

    targets = get_components(ac, elements) if use_comp else elements
    if not targets:
        return []

    ids, missing = resolve_property_ids(ac, [qty_name, group_name])
    for m in missing:
        warnings.append("กฎ '%s' (%s): ไม่พบ property '%s' ในโปรเจกต์นี้" % (rule["item"], etype, m))
    if qty_name != "COUNT" and qty_name not in ids:
        return []

    names = [n for n in (qty_name, group_name) if n in ids]
    values = get_values(ac, targets, [ids[n] for n in names], components=use_comp) if names else \
        [[] for _ in targets]

    groups = OrderedDict()
    for vals in values:
        row = dict(zip(names, vals))
        if qty_name == "COUNT":
            q = 1.0
        else:
            q = row.get(qty_name)
            if not isinstance(q, (int, float)):
                continue
        g = row.get(group_name) if group_name else ""
        g = str(g).strip() if g not in (None, "") else ("(ไม่ระบุ)" if group_name else "")
        acc = groups.setdefault(g, [0.0, 0])
        acc[0] += float(q)
        acc[1] += 1

    lines = []
    for g, (q, n) in groups.items():
        item = rule["item"].replace("{group}", g).strip()
        note = "ปริมาณจากโมเดล Archicad: %s %d %s (%s)" % (
            etype, n, "ชั้นวัสดุ" if use_comp else "ชิ้น", qty_name)
        lines.append({"category": rule.get("category", "ไม่ระบุหมวด"), "item": item,
                      "qty": round(q * factor, 3), "unit": rule.get("unit", ""), "note": note})
    return lines


def build_boq(ac, rules, project_label):
    warnings, cats = [], OrderedDict()
    for rule in rules:
        try:
            for line in run_rule(ac, rule, warnings):
                cats.setdefault(line["category"], []).append(line)
        except ArchicadError as e:
            warnings.append("กฎ '%s': %s" % (rule.get("item"), e))
    rows = []
    for ci, (cat, lines) in enumerate(cats.items(), 1):
        rows.append([str(ci), cat, "", "", 0, "0.00", 0, "0.00", "0.00", ""])
        for li, ln in enumerate(lines, 1):
            note = ln["note"] + (" · " + project_label if project_label else "")
            qty = ln["qty"]
            qty = int(qty) if float(qty).is_integer() else qty
            rows.append(["%d.%d" % (ci, li), ln["item"], qty, ln["unit"],
                         0, "0.00", 0, "0.00", "0.00", note])
    return rows, warnings


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, quoting=csv.QUOTE_NONNUMERIC)
        f.write(",".join(HEADER) + "\r\n")
        for r in rows:
            w.writerow(r)


# ---------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description="ดึงปริมาณจาก Archicad เป็น BOQ CSV")
    ap.add_argument("-c", "--config", help="ไฟล์ JSON ที่มี {\"rules\": [...]} (ไม่ใส่ = ใช้กฎตั้งต้น)")
    ap.add_argument("-o", "--out", default="BOQ_Archicad.csv", help="ไฟล์ CSV ที่จะเขียน")
    ap.add_argument("-p", "--port", type=int, help="พอร์ต JSON API (ไม่ใส่ = ค้นหาอัตโนมัติ 19723-19743)")
    ap.add_argument("--label", default="", help="ข้อความต่อท้ายหมายเหตุ เช่น เลขที่ถอดแบบ")
    ap.add_argument("--list-properties", action="store_true", help="เขียนรายชื่อ property ทั้งหมดลง properties.txt")
    ap.add_argument("--write-default-config", action="store_true", help="เขียนกฎตั้งต้นเป็น boq_config.json แล้วจบ")
    a = ap.parse_args(argv)

    if a.write_default_config:
        with open("boq_config.json", "w", encoding="utf-8") as f:
            json.dump({"rules": DEFAULT_RULES}, f, ensure_ascii=False, indent=2)
        print("เขียน boq_config.json แล้ว")
        return 0

    ac, port = find_archicad(a.port)
    if not ac:
        print("ไม่พบ Archicad ที่เปิด JSON API อยู่ (ลองพอร์ต %s)\n"
              "ให้เปิด Archicad พร้อมโปรเจกต์ก่อน แล้วรันใหม่" % (a.port or "19723-19743"))
        return 2
    print("เชื่อมต่อ Archicad ที่พอร์ต %d แล้ว" % port)

    if a.list_properties:
        props = ac.call("API.GetAllPropertyNames").get("properties", [])
        with open("properties.txt", "w", encoding="utf-8") as f:
            for p in props:
                f.write((p.get("nonLocalizedName") or "/".join(p.get("localizedName", []))) + "\n")
        print("เขียน %d รายการลง properties.txt" % len(props))
        return 0

    rules = DEFAULT_RULES
    if a.config:
        with open(a.config, encoding="utf-8-sig") as f:
            rules = json.load(f)["rules"]

    rows, warnings = build_boq(ac, rules, a.label)
    write_csv(a.out, rows)
    n_items = sum(1 for r in rows if "." in r[0])
    print("เขียน %s แล้ว: %d หมวด %d รายการ" % (a.out, len(rows) - n_items, n_items))
    for w in warnings:
        print("คำเตือน:", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
