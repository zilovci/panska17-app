-- Časovo-vážená alokácia vykurovania
-- Pridáva stĺpce pre mesiace obsadenia do expense_allocations

-- Mesiace obsadenia nájomcom v rámci fakturačného obdobia
ALTER TABLE expense_allocations 
ADD COLUMN IF NOT EXISTS months_occupied smallint DEFAULT NULL;

-- Celkový počet mesiacov fakturačného obdobia
ALTER TABLE expense_allocations 
ADD COLUMN IF NOT EXISTS months_total smallint DEFAULT NULL;

-- Pravidlo pre prázdne zóny na kategórii
-- 'owner'         = vlastník platí plnú plochu za prázdne mesiace (poistka, daň)
-- 'owner_temper'   = vlastník platí zníženú plochu podľa tempering % (vykurovanie)
-- 'exclude'        = prázdne mesiace sa vylúčia, platia len obsadení (smetie, voda, upratovanie)
ALTER TABLE cost_categories
ADD COLUMN IF NOT EXISTS empty_zone_rule text DEFAULT 'owner';

-- Nastaviť defaultné pravidlá pre existujúce kategórie
UPDATE cost_categories SET empty_zone_rule = 'owner_temper' WHERE name = 'Vykurovanie';
UPDATE cost_categories SET empty_zone_rule = 'exclude' WHERE name IN ('Odvoz smetí', 'Voda a kanalizácia', 'Upratovanie');
UPDATE cost_categories SET empty_zone_rule = 'owner' WHERE name IN ('EPS a PO', 'Správa', 'Náklady na budovu', 'Údržba', 'Ostatné');

-- Elektrina ide podľa merača
UPDATE cost_categories SET allocation_method = 'meter' WHERE name = 'Elektrina' AND (allocation_method IS NULL OR allocation_method = 'area');

-- Merač môže patriť do inej kategórie než default podľa typu
-- Napr. elektromer v kotolni → Vykurovanie, vodomer na dvore → Upratovanie
ALTER TABLE meters
ADD COLUMN IF NOT EXISTS cost_category_id uuid REFERENCES cost_categories(id) DEFAULT NULL;

-- Vlastník budovy ako nájomca
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS is_owner boolean DEFAULT false;

-- Typ nákladu a amortizácia
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS cost_type text DEFAULT 'operating';
-- 'operating'  = bežný prevádzkový (rozpočíta sa v roku vzniku)
-- 'amortized'  = amortizovaný (rozpočíta sa na X rokov)
-- 'investment' = investičný (platí vlastník, nerozpočítava sa)

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS amort_years smallint DEFAULT NULL;

-- Fakturačná plocha (ak iná než plocha v rozpočte budovy)
-- Napr. restaurácia: area_m2 = 120 (pôvodná stavba),
-- billing_area_m2 = 345 (celý priestor vrátane prístavby čiernej stavby)
-- Pool/denominator vždy používa area_m2, numerátor/faktúra billing_area_m2
ALTER TABLE zones
ADD COLUMN IF NOT EXISTS billing_area_m2 numeric(10,2) DEFAULT NULL;

-- Komentár:
-- months_occupied = NULL → štandardná alokácia (celé obdobie)
-- months_occupied = 7, months_total = 12 → nájomca obsadil 7 z 12 mesiacov
-- empty_zone_rule určuje čo sa stane so zvyšnými 5 mesiacmi

-- Nájomca: účty pre platby (nájom + služby) a bez vyúčtovania (paušál)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS payment_account text DEFAULT NULL;

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS service_account text DEFAULT NULL;

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS no_billing boolean DEFAULT false;

-- Nová kategória EZS
INSERT INTO cost_categories (name, empty_zone_rule)
SELECT 'EZS', 'owner'
WHERE NOT EXISTS (SELECT 1 FROM cost_categories WHERE name = 'EZS');

-- Metóda alokácie - pamätá si area/meter pre každý náklad
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS alloc_method text DEFAULT 'area';

-- Referenčné číslo pre krížovú kontrolu s Excelom
ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS ref_number text DEFAULT NULL;

-- Platby: dátum úhrady a poznámka
ALTER TABLE tenant_payments
ADD COLUMN IF NOT EXISTS paid_date date DEFAULT NULL;

ALTER TABLE tenant_payments
ADD COLUMN IF NOT EXISTS note text DEFAULT NULL;
