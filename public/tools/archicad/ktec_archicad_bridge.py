#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ตัวเชื่อม Archicad <-> KTech ERP

รันไว้บนเครื่องที่เปิด Archicad อยู่ แล้วกดปุ่ม "ดึงจาก Archicad" ในหน้าถอดแบบของ ERP
ตัวเชื่อมจะถาม Archicad ผ่าน JSON API (localhost) แล้วส่งปริมาณกลับให้หน้าเว็บ

    python ktec_archicad_bridge.py               # เปิดตัวเชื่อมที่พอร์ต 19780
    python ktec_archicad_bridge.py --test        # ดึงปริมาณครั้งเดียวแล้วพิมพ์ออกจอ (ไว้ตรวจ)
    python ktec_archicad_bridge.py --write-default-config   # เขียนกฎตั้งต้นเป็น boq_config.json

ปรับกฎการถอดแบบได้ในไฟล์ boq_config.json ที่อยู่โฟลเดอร์เดียวกัน
ใช้แค่ไลบรารีมาตรฐานของ Python 3.8+ ไม่ต้องติดตั้งอะไรเพิ่ม
ตัวเชื่อมรับคำขอจากเครื่องนี้เท่านั้น (127.0.0.1) และอ่านโมเดลอย่างเดียว ไม่แก้ไขโมเดล
"""
import argparse
import json
import os
import sys
import urllib.request
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

VERSION = "1.0"
BRIDGE_PORT = 19780
ARCHICAD_PORTS = range(19723, 19744)
BATCH = 500
HERE = os.path.dirname(os.path.abspath(__file__))

# เว็บที่ได้รับอนุญาตให้ถามตัวเชื่อม (เพิ่มได้ใน boq_config.json -> "allowed_origins")
ALLOWED_ORIGINS = ["https://ktech-erp.onrender.com"]
LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")

# ---------------------------------------------------------------- กฎตั้งต้น
# แต่ละกฎ = หนึ่งกลุ่มรายการใน BOQ
#   category      : หมวดงาน
#   element_type  : ชนิดชิ้นส่วนใน Archicad (Wall, Slab, Column, Beam, Roof, Zone,
#                   Door, Window, Object, Railing, Stair, Mesh, CurtainWall ...)
#   item          : ชื่อรายการ ใส่ {group} เพื่อแทนด้วยค่าที่จัดกลุ่ม
#   group_by      : ชื่อ built-in property หรือ "ชื่อกลุ่ม/ชื่อ property" ของ user-defined
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
    {"category": "งานผนัง", "element_type": "Wall", "item": "ความยาวผนัง {group}",
     "group_by": "General_BuildingMaterials", "quantity": "Wall_ReferenceLineLength", "unit": "ม."},
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
    {"category": "งานบันได", "element_type": "Stair", "item": "บันได",
     "quantity": "COUNT", "unit": "ชุด"},
    {"category": "พื้นที่ใช้สอย", "element_type": "Zone", "item": "พื้นที่ {group}",
     "group_by": "Zone_ZoneName", "quantity": "Zone_NetArea", "unit": "ตร.ม."},
]


# ---------------------------------------------------------------- JSON API ของ Archicad
class ArchicadError(Exception):
    pass


class Archicad:
    def __init__(self, port):
        self.port = port
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


def find_archicad():
    for p in ARCHICAD_PORTS:
        try:
            ac = Archicad(p)
            ac.call("API.IsAlive", timeout=1.5)
            return ac
        except Exception:
            continue
    return None


def archicad_info(ac):
    """ชื่อเวอร์ชันและชื่อโปรเจกต์ (ชื่อโปรเจกต์ต้องมี Tapir add-on ถ้าไม่มีก็ข้าม)"""
    info = {"port": ac.port, "version": "", "project": ""}
    try:
        r = ac.call("API.GetProductInfo", timeout=5)
        info["version"] = "Archicad %s" % r.get("version", "")
    except Exception:
        pass
    try:
        r = ac.call("API.ExecuteAddOnCommand", {
            "addOnCommandId": {"commandNamespace": "TapirCommand", "commandName": "GetProjectInfo"},
            "addOnCommandParameters": {}}, timeout=5)
        r = r.get("addOnCommandResponse", r)
        info["project"] = r.get("projectName") or ""
    except Exception:
        pass
    return info


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def property_ref(name):
    if "/" in name:
        return {"type": "UserDefined", "localizedName": name.split("/", 1)}
    return {"type": "BuiltIn", "nonLocalizedName": name}


def resolve_property_ids(ac, names):
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


def get_values(ac, targets, prop_ids, components=False):
    out = []
    props = [{"propertyId": g} for g in prop_ids]
    for part in chunks(targets, BATCH):
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


def guid_of(el):
    return (el.get("elementId") or {}).get("guid", "").upper()


def selected_guids(ac):
    res = ac.call("API.GetSelectedElements")
    return {guid_of(e) for e in res.get("elements", [])}


# ---------------------------------------------------------------- ถอดปริมาณ
def run_rule(ac, rule, warnings, only=None):
    etype = rule["element_type"]
    elements = ac.call("API.GetElementsByType", {"elementType": etype}).get("elements", [])
    if only is not None:
        elements = [e for e in elements if guid_of(e) in only]
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
        qty = round(q * factor, 3)
        if qty <= 0:
            continue
        lines.append({
            "category": rule.get("category", "ไม่ระบุหมวด"),
            "description": rule["item"].replace("{group}", g).strip(),
            "qty": qty,
            "unit": rule.get("unit", ""),
            "elementType": etype,
            "count": n,
            "note": "Archicad: %s %d %s (%s)" % (etype, n, "ชั้นวัสดุ" if use_comp else "ชิ้น", qty_name),
        })
    return lines


def load_config():
    path = os.path.join(HERE, "boq_config.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def take_off(ac, scope="all"):
    cfg = load_config()
    rules = cfg.get("rules") or DEFAULT_RULES
    warnings, rows = [], []
    only = None
    if scope == "selected":
        only = selected_guids(ac)
        if not only:
            return {"rows": [], "warnings": ["ยังไม่ได้เลือกชิ้นส่วนใน Archicad"]}
    for rule in rules:
        try:
            rows.extend(run_rule(ac, rule, warnings, only))
        except ArchicadError as e:
            warnings.append("กฎ '%s': %s" % (rule.get("item"), e))
    return {"rows": rows, "warnings": warnings}


# ---------------------------------------------------------------- เซิร์ฟเวอร์บนเครื่อง
def origin_allowed(origin):
    if not origin:
        return True  # เรียกจากโปรแกรมบนเครื่อง เช่น curl
    extra = load_config().get("allowed_origins") or []
    if origin in ALLOWED_ORIGINS or origin in extra:
        return True
    host = urlparse(origin).hostname or ""
    return host in ("localhost", "127.0.0.1", "::1")


class Handler(BaseHTTPRequestHandler):
    server_version = "KTecArchicadBridge/" + VERSION

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Chrome: หน้าเว็บสาธารณะขอคุยกับเครื่องตัวเอง (Private/Local Network Access)
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

    def _json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _guard(self):
        if not origin_allowed(self.headers.get("Origin")):
            self._json(403, {"ok": False, "error": "เว็บนี้ไม่ได้รับอนุญาตให้ใช้ตัวเชื่อม"})
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(204 if origin_allowed(self.headers.get("Origin")) else 403)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._guard():
            return
        if self.path.split("?")[0] != "/status":
            return self._json(404, {"ok": False, "error": "not found"})
        ac = find_archicad()
        if not ac:
            return self._json(200, {"ok": True, "bridge": VERSION, "archicad": None})
        self._json(200, {"ok": True, "bridge": VERSION, "archicad": archicad_info(ac)})

    def do_POST(self):
        if not self._guard():
            return
        if self.path.split("?")[0] != "/takeoff":
            return self._json(404, {"ok": False, "error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
        except Exception:
            return self._json(400, {"ok": False, "error": "คำขอไม่ถูกต้อง"})
        ac = find_archicad()
        if not ac:
            return self._json(503, {"ok": False, "error": "ไม่พบ Archicad ให้เปิด Archicad พร้อมโปรเจกต์ก่อน"})
        try:
            scope = "selected" if req.get("scope") == "selected" else "all"
            res = take_off(ac, scope)
            res.update({"ok": True, "archicad": archicad_info(ac), "scope": scope})
            print("ส่งปริมาณ %d รายการให้หน้าเว็บแล้ว" % len(res["rows"]))
            self._json(200, res)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": "ถอดปริมาณไม่สำเร็จ: %s" % e})

    def log_message(self, fmt, *args):
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(description="ตัวเชื่อม Archicad กับ KTech ERP")
    ap.add_argument("-p", "--port", type=int, default=BRIDGE_PORT, help="พอร์ตของตัวเชื่อม (ค่าตั้งต้น 19780)")
    ap.add_argument("--test", action="store_true", help="ดึงปริมาณครั้งเดียวแล้วพิมพ์ออกจอ")
    ap.add_argument("--write-default-config", action="store_true", help="เขียนกฎตั้งต้นเป็น boq_config.json")
    a = ap.parse_args(argv)

    if a.write_default_config:
        with open(os.path.join(HERE, "boq_config.json"), "w", encoding="utf-8") as f:
            json.dump({"allowed_origins": [], "rules": DEFAULT_RULES}, f, ensure_ascii=False, indent=2)
        print("เขียน boq_config.json แล้ว")
        return 0

    if a.test:
        ac = find_archicad()
        if not ac:
            print("ไม่พบ Archicad ที่เปิดอยู่ (ลองพอร์ต 19723-19743)")
            return 2
        print(json.dumps(take_off(ac), ensure_ascii=False, indent=2))
        return 0

    try:
        srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    except OSError:
        print("พอร์ต %d ถูกใช้อยู่ ตัวเชื่อมอาจเปิดอยู่แล้วในหน้าต่างอื่น" % a.port)
        return 1
    print("ตัวเชื่อม Archicad พร้อมแล้ว (พอร์ต %d)" % a.port)
    print("กลับไปที่หน้าถอดแบบใน KTech ERP แล้วกดปุ่ม \"ดึงจาก Archicad\"")
    print("เปิดหน้าต่างนี้ไว้ระหว่างใช้งาน ปิดหน้าต่างเมื่อเลิกใช้")
    ac = find_archicad()
    print("สถานะ Archicad: %s" % ("เชื่อมต่อแล้ว (พอร์ต %d)" % ac.port if ac else "ยังไม่เปิด"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
