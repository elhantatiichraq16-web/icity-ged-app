-- La recherche doit ignorer les accents (§11).
--
-- PostgreSQL les distingue : « videosurveillance » ne
-- trouvait pas « vidéosurveillance ». Or personne ne tape les accents dans une
-- barre de recherche.
--
-- On déclare une configuration « fr » qui enchaîne `unaccent` et la
-- désuffixation française : « marchés » et « marches » mènent au même mot.
-- Une configuration nommée est indispensable, car un index ne peut porter que
-- des expressions IMMUTABLE — `unaccent(texte)` seul ne l'est pas.
CREATE EXTENSION IF NOT EXISTS unaccent;

DROP TEXT SEARCH CONFIGURATION IF EXISTS fr CASCADE;
CREATE TEXT SEARCH CONFIGURATION fr (COPY = french);

ALTER TEXT SEARCH CONFIGURATION fr
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, french_stem;

-- L'index doit porter exactement l'expression que le service interroge,
-- sinon PostgreSQL l'ignore sans rien signaler : la recherche marcherait,
-- mais en relisant tout le fonds à chaque fois.
DROP INDEX IF EXISTS documents_recherche_idx;

CREATE INDEX documents_recherche_idx
  ON documents
  USING GIN (to_tsvector('fr', coalesce(titre, '') || ' ' || coalesce(texte_ocr, '')));
