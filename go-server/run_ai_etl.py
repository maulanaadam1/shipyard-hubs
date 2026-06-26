import json
import psycopg2
import psycopg2.extras
from concurrent.futures import ThreadPoolExecutor

# Konfigurasi koneksi langsung ke PostgreSQL Easypanel
DB_URL = "postgres://postgres:ofv17qs766typz8dig9y@43.157.204.11:5432/stage1?sslmode=disable"

def process_wo(row):
    wo_id, raw_json_str = row
    try:
        data = json.loads(raw_json_str)
        if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
            data = data["data"]
            
        m_wo = data.get("master_wo", {})
        if not isinstance(m_wo, dict): m_wo = {}
        
        vendor = m_wo.get("m_vendor_name", "")
        ship = m_wo.get("m_ship_name", "")
        jo_id = m_wo.get("t_job_order_id", "")
        jo_code = m_wo.get("t_job_order_code", "")
        wo_code = m_wo.get("code", "")
        total_cost = m_wo.get("total_cost_contract", 0)
        status_approval = data.get("approval_status", "Unknown")
        created_at = m_wo.get("created_at") or "2026-01-01 00:00:00"
        
        breakdowns = []
        deliveries = []
        
        def parse_repair(items, parent_id, path_prefix):
            if not isinstance(items, list): return
            for idx, item in enumerate(items):
                if not isinstance(item, dict): continue
                b_id = str(item.get("id") or f"{wo_id}_{path_prefix}_{idx}")
                label = str(item.get("label") or item.get("name") or "")
                remark = str(item.get("remark") or "")
                unit = str(item.get("unit") or "")
                vol = float(item.get("volume") or 0)
                price = float(item.get("price") or 0)
                tot_price = vol * price
                if tot_price == 0 and price > 0: tot_price = price
                
                path = f"{path_prefix}.{idx+1}" if path_prefix else str(idx+1)
                breakdowns.append((b_id, wo_id, str(jo_id), vendor, ship, parent_id or None, path, label, remark, vol, unit, price, tot_price, 0, status_approval))
                
                if isinstance(item.get("material"), list):
                    parse_repair(item["material"], b_id, path)

        if isinstance(data.get("repair_list"), list):
            parse_repair(data["repair_list"], None, "")
            
        def parse_del(obj):
            if isinstance(obj, list):
                for elem in obj: parse_del(elem)
            elif isinstance(obj, dict):
                if isinstance(obj.get("t_delivery_details"), list):
                    req_id = str(obj.get("t_requisition_id") or "")
                    for del_item in obj["t_delivery_details"]:
                        if not isinstance(del_item, dict): continue
                        d_id = str(del_item.get("id") or "")
                        qty = float(del_item.get("quantity") or 0)
                        comp = del_item.get("m_component") or {}
                        comp_code = str(comp.get("code") or "")
                        comp_name = str(comp.get("description") or "")
                        part_no = str(comp.get("part_no") or "")
                        unit = str(comp.get("unit") or "")
                        
                        rcv = del_item.get("t_receiving_detail") or {}
                        u_price = float(rcv.get("unit_price") or 0)
                        t_price = u_price * qty
                        curr = str(rcv.get("currency") or "IDR")
                        
                        tdel = del_item.get("t_delivery") or {}
                        del_code = str(tdel.get("code") or "")
                        del_date = str(tdel.get("date") or created_at)
                        rcv_name = str(tdel.get("receiver") or "")
                        rcv_vendor = str(tdel.get("receiver_vendor") or "")
                        
                        deliveries.append((d_id, wo_id, str(jo_id), vendor, ship, req_id, comp_code, comp_name, part_no, qty, unit, u_price, t_price, curr, del_code, del_date, rcv_name, rcv_vendor))
                for v in obj.values(): parse_del(v)
                
        parse_del(data)
        return wo_id, (wo_id, str(jo_id), jo_code, wo_code, vendor, ship, total_cost, status_approval, created_at), breakdowns, deliveries
    except Exception as e:
        return None

def main():
    print("[1/4] Menghubungkan ke PostgreSQL Easypanel...")
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()
    
    print("[2/4] Mengecek antrean Work Orders yang belum di-flatten...")
    cur.execute("SELECT wo_id, raw_json FROM work_order_details WHERE wo_id NOT IN (SELECT wo_id FROM ai_work_orders)")
    rows = cur.fetchall()
    
    total = len(rows)
    if total == 0:
        print("\n=== SELESAI! Seluruh Work Orders sudah ter-flatten ke tabel AI. ===")
        return
        
    print(f"[3/4] Ditemukan {total} surat kerja baru. Membongkar JSON secara paralel...")
    
    wo_records = []
    all_breakdowns = []
    all_deliveries = []
    completed = 0
    
    with ThreadPoolExecutor(max_workers=16) as pool:
        for res in pool.map(process_wo, rows):
            completed += 1
            if completed % 25 == 0 or completed == total:
                percent = int(completed * 100 / total)
                print(f"      -> Progress JSON Unwrapping: {completed} / {total} surat ({percent}%)")
            if not res: continue
            _, wo_rec, b_list, d_list = res
            wo_records.append(wo_rec)
            all_breakdowns.extend(b_list)
            all_deliveries.extend(d_list)
            
    print(f"\n[4/4] Siap menyuntikkan ke Database:")
    print(f"      - {len(wo_records)} baris Master WO")
    print(f"      - {len(all_breakdowns)} baris Rincian Pekerjaan")
    print(f"      - {len(all_deliveries)} baris Logistik Barang")
    print("      Sedang mengunggah paket data ke server (Batch Upsert)...")
    
    sql_wo = """
        INSERT INTO ai_work_orders (wo_id, jo_id, jo_code, wo_code, vendor_name, ship_name, total_cost_contract, status_approval, created_at)
        VALUES %s ON CONFLICT (wo_id) DO UPDATE SET total_cost_contract = EXCLUDED.total_cost_contract
    """
    sql_b = """
        INSERT INTO ai_wo_breakdowns (id, wo_id, jo_id, vendor_name, ship_name, parent_id, path, label, remark, volume, unit, price, total_price, approved_level, status_approval)
        VALUES %s ON CONFLICT (id) DO NOTHING
    """
    sql_d = """
        INSERT INTO ai_material_deliveries (id, wo_id, jo_id, vendor_name, ship_name, requisition_id, component_code, component_name, part_no, qty_delivered, unit, unit_price, total_price, currency, delivery_code, delivery_date, receiver_name, receiver_vendor)
        VALUES %s ON CONFLICT (id) DO NOTHING
    """
    
    if wo_records: psycopg2.extras.execute_values(cur, sql_wo, wo_records)
    if all_breakdowns: psycopg2.extras.execute_values(cur, sql_b, all_breakdowns)
    if all_deliveries: psycopg2.extras.execute_values(cur, sql_d, all_deliveries)
    
    conn.commit()
    cur.close()
    conn.close()
    print("\n=== MIGRASI PYTHON SELESAI 100% SUKSES! ===")

if __name__ == "__main__":
    main()
