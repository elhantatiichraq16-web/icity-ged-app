-- La recherche plein texte (§11).
--
-- PostgreSQL n'a pas d'index plein texte déclaratif : on pose un
-- index GIN sur l'expression `tsvector` que le service interroge. L'index doit
-- porter exactement la même expression que la requête, sinon il est ignoré
-- sans que rien ne le signale — la recherche marcherait, mais lentement.
--
-- La configuration « french » applique la désuffixation : « marchés » trouve
-- « marché ». Elle doit être IMMUTABLE pour entrer dans un index, d'où la
-- forme figée plutôt qu'un réglage de session.
CREATE INDEX documents_recherche_idx
  ON documents
  USING GIN (to_tsvector('french', coalesce(titre, '') || ' ' || coalesce(texte_ocr, '')));
