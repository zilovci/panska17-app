-- Obsadenost priestorov po usekoch: jeden priestor moze mat viac najomcov za sebou
-- (napr. B4S: Eiben do 30.4.2023, Gschill od 1.5.2023). Useky sa nesmu prekryvat.
-- zones.tenant_id zostava ako "aktualny najomca" (odvodeny z posledneho useku).

CREATE TABLE IF NOT EXISTS zone_tenancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date_from date,            -- NULL = od zaciatku evidencie
  date_to date,              -- NULL = trva
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zone_tenancies_zone_idx ON zone_tenancies(zone_id);
CREATE INDEX IF NOT EXISTS zone_tenancies_tenant_idx ON zone_tenancies(tenant_id);

ALTER TABLE zone_tenancies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin manage zone_tenancies" ON zone_tenancies;
CREATE POLICY "Admin manage zone_tenancies" ON zone_tenancies FOR ALL
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.user_id = auth.uid() AND user_profiles.role = ANY (ARRAY['admin'::text, 'spravca'::text])));
DROP POLICY IF EXISTS "Auth read zone_tenancies" ON zone_tenancies;
CREATE POLICY "Auth read zone_tenancies" ON zone_tenancies FOR SELECT USING (true);

-- Rozpocet polozky: riadok patri konkretnemu najomcovi (NULL = stary zaznam, patri najomcovi zony)
ALTER TABLE expense_allocations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expense_allocations_tenant_idx ON expense_allocations(tenant_id);

-- Naplnenie z dnesnych udajov: kazda zona so svojim najomcom a jeho zmluvnymi datumami
INSERT INTO zone_tenancies (zone_id, tenant_id, date_from, date_to, note)
SELECT z.id, z.tenant_id, t.lease_from, t.lease_to, 'prevzaté z pôvodného priradenia zóny'
FROM zones z JOIN tenants t ON t.id = z.tenant_id
WHERE z.tenant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM zone_tenancies zt WHERE zt.zone_id = z.id AND zt.tenant_id = z.tenant_id);

-- B4S: Frantisek Gschill od 1.5.2023 (po Eibenovi, ktory skoncil 30.4.2023)
INSERT INTO zone_tenancies (zone_id, tenant_id, date_from, date_to, note)
SELECT z.id, t.id, t.lease_from, t.lease_to, 'doplnené 26.10.2026'
FROM zones z, tenants t
WHERE z.name = 'B4S' AND t.name = 'Frantisek Gschill'
  AND NOT EXISTS (SELECT 1 FROM zone_tenancies zt WHERE zt.zone_id = z.id AND zt.tenant_id = t.id);
