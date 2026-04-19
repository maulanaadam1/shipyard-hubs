-- SQL Script untuk update Struktur Table equipment di Supabase
-- Script ini akan menyesuaikan data existing ke struktur baru yang diminta.
-- id, created_at, updated_at, source, no_asset, type, brand, name, capacity, year_invest, available, alias, price

------------------------------------------------------------------
-- 1. Rename existing columns to match the new schema directly
------------------------------------------------------------------
ALTER TABLE equipment RENAME COLUMN created_date TO created_at;
ALTER TABLE equipment RENAME COLUMN status TO available;
ALTER TABLE equipment RENAME COLUMN category TO type;
ALTER TABLE equipment RENAME COLUMN type_capacity TO capacity;
ALTER TABLE equipment RENAME COLUMN year TO year_invest;

------------------------------------------------------------------
-- 2. Rename 'location' to 'source' (assuming mapping based on context)
------------------------------------------------------------------
-- Jika anda ingin map data 'location' ke 'source':
ALTER TABLE equipment RENAME COLUMN location TO source;

-- ATAU jika 'location' dihapus, dan 'source' coloumn yang benar-benar baru:
-- ALTER TABLE equipment DROP COLUMN location;
-- ALTER TABLE equipment ADD COLUMN source TEXT;

------------------------------------------------------------------
-- 3. Add new fields
------------------------------------------------------------------
ALTER TABLE equipment ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE equipment ADD COLUMN price TEXT;

------------------------------------------------------------------
-- 4. Drop unused columns (HATI-HATI PADA DATA ANDA)
------------------------------------------------------------------
-- Jika 'no', 'item', dan 'product_identifier' benar-benar tidak dipakai dan datanya ingin dihapus:
ALTER TABLE equipment DROP COLUMN no;
ALTER TABLE equipment DROP COLUMN item;
ALTER TABLE equipment DROP COLUMN product_identifier;

-- Catatan Penting:
-- 1. Jalankan script ini di menu "SQL Editor" pada console Supabase Anda.
-- 2. Pastikan Anda telah mem-backup data pada table `equipment` sebelum menjalankan DROP data,
--    supaya mengurangi resiko kehilangan data yang masih dibutuhkan secara tidak disengaja.
