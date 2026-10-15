-- Cor de identidade da equipe (#RRGGBB), escolhida por dono/admin. NULL = sem escolha: o servidor devolve a cor
-- derivada do id (mesma paleta e hash que o cliente já usava), então equipes existentes não mudam de aparência.
ALTER TABLE equipe ADD COLUMN cor TEXT;
