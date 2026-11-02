# K-3: potvrda probnog nastavnika isključivo u lokalnom okruženju

Ovo je **izričita radnja operatora nad izmišljenim računom**, a ne produkcijska autorizacija ni AAI@EduHr upravljanje korisnicima. Prijava preko lažnog OIDC pružatelja s atributom `employee` sama po sebi ne dodjeljuje ulogu `teacher` koju zahtijeva `institution.create_course`.

1. Na računalu s dopuštenim Docker Composeom pokreni `pnpm stack:up`, `pnpm db:migrate` i `pnpm db:seed`.
2. Pokreni `pnpm dev` i prijavi se putem **Demo prijava → Demo nastavnik** na `http://localhost:3000`. Tek ta prijava stvara sintetički redak u `identity.user_account`.
3. Iz korijena repozitorija pokreni `node scripts/demo/provision-teacher.mjs`. Skripta šalje točno određeni SQL kroz `docker compose exec -T postgres psql` na lokalni socket kontejnera. SQL zahtijeva bazu `ductus`, izdavatelja `http://localhost:8090`, izmišljeni račun i ustanovu `demo-fakultet`. Ponovljeno izvršenje ne duplicira aktivnu ulogu. Ako račun još nije nastao, naredba **pada**, bez automatskog stvaranja identiteta.
4. Pokreni `pnpm test:e2e:login` ili pregledaj postojeći GitHub CI posao `Local stack (compose.yaml)`. Novi test na čistom stogu provjerava odbijanje nepotvrđenog nastavnika, eksplicitnu lokalnu dodjelu te odbijanje pokušaja studenta da stvori kolegij.

Ni jedna Next.js ruta, migracija ili produkcijska inicijalizacija ne poziva ovu naredbu. **Nikada je ne pokretati nad stvarnom ustanovom ili produkcijskom bazom.** Normalna potvrda nastavnika i dalje ide preko administratora i `institution.confirm_teacher_role`. Za kompletan K-4 prolaz još nedostaju F-6 nastavničko sučelje, F-7 upis, F-8 poslužiteljsko spremanje, F-9 komentari i F-10 predaja.

Bez Dockera, uz pokrenut `pnpm demo:up:native` (`docs/DEMO-UP.md`, "Bez Dockera"), korak 3 je `node scripts/demo/provision-teacher.mjs --native` (DAN-346). Isti SQL ide samo kroz lokalni socket nativne baze, pinanim `psql.exe` iz `%LOCALAPPDATA%\Ductus\native\`. Skripta prije poziva provjerava hash stabla te mape i ništa ne preuzima. `--native` radi samo na Windowsima.

Na korisničkom Windows računalu Docker/WSL može biti blokiran; Linux GitHub Actions runner ostaje referentno okruženje. CI uspjeh ne zamjenjuje neovisan review/QA. Promjena `db/local/` podliježe pravilu D-97 i izričitoj vlasničkoj naredbi za broj PR-a i puni head SHA.
