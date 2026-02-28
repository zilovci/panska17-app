-- Reštaurácia: area_m2 = legálna plocha (pool), billing_area_m2 = užívaná plocha (faktúra)
-- Najprv zistíme ID zóny:
-- SELECT id, name, area_m2, billing_area_m2 FROM zones WHERE name ILIKE '%gatto%' OR name ILIKE '%rest%';

-- Potom update (uprav ID podľa výsledku):
-- UPDATE zones SET area_m2 = 200, billing_area_m2 = 364 WHERE id = '<zone_id>';
