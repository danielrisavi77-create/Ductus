# Besplatni savjetodavni AI pregled PR-a (DAN-200)

Predloženi GitHub Actions agent na PR-u čita samo diff i piše savjetodavni Actions Summary.
Ne izvršava PR kod, ne piše komentare niti kanonske review/QA verdikte i nikad ne spaja PR.
AI način rada zahtijeva besplatni Groq API ključ pod nazivom `GROQ_API_KEY` u GitHub Actions secrets, a bez njega izvještava da je AI pregled preskočen.

Početak rada i spajanje promjena podliježe D-97: samo uz Danielovo odobrenje za konkretan PR i head SHA.
