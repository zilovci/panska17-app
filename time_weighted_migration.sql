-- Časovo-vážená alokácia vykurovania
-- Pridáva stĺpce pre mesiace obsadenia do expense_allocations

-- Mesiace obsadenia nájomcom v rámci fakturačného obdobia
ALTER TABLE expense_allocations 
ADD COLUMN IF NOT EXISTS months_occupied smallint DEFAULT NULL;

-- Celkový počet mesiacov fakturačného obdobia
ALTER TABLE expense_allocations 
ADD COLUMN IF NOT EXISTS months_total smallint DEFAULT NULL;

-- Komentár: 
-- months_occupied = NULL → štandardná alokácia (celé obdobie)
-- months_occupied = 7, months_total = 12 → nájomca obsadil 7 z 12 mesiacov
-- Zvyšných 5 mesiacov je temperovanie (owner platí)
