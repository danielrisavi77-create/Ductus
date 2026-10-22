# Storybook: lokalni prikazi za FPZG demo (DAN-246)

Ovaj pilot prikazuje **stvarni** `LogoutDialog` u pet sintetičkih stanja, bez pokretanja aplikacijske prijave, baze ili Docker stoga.

Iz izoliranog Storybook worktreea (Node >=24, projektni pnpm 10.33.0):

```bash
pnpm install --frozen-lockfile
pnpm storybook
```

Otvoriti samo na vlastitom računalu: `http://127.0.0.1:6006`. Storybook se po zadanoj naredbi veže na `127.0.0.1`; telemetrija i automatsko otvaranje preglednika su isključeni. Ne objavljivati razvojnu instancu javno.

Pet izravnih priča:
- [Obična odjava](http://127.0.0.1:6006/?path=/story/demo-odjava--plain)
- [Izmjene ostaju na uređaju](http://127.0.0.1:6006/?path=/story/demo-odjava--pending)
- [Nespremljeni tekst](http://127.0.0.1:6006/?path=/story/demo-odjava--unsaved)
- [Odjava u tijeku](http://127.0.0.1:6006/?path=/story/demo-odjava--working)
- [Odjava nije uspjela](http://127.0.0.1:6006/?path=/story/demo-odjava--failed)

**Kako koristiti:** u prikazu probati Ostani, Odjavi se, Izvezi tekst (kad je ponuđen), Escape i ponovno otvaranje. Ispod gumba prikazuje se isključivo naziv odabranog callbacka. Wrapper ne poziva stvarnu odjavu, ne izvozi datoteku, ne mijenja pohranu i ne šalje sadržaj rada. U stanju `working` akcijski gumbi moraju ostati onemogućeni.

Priče ponovno koriste postojeće projektne CSS tokene i lokalne fontove. Ovo je vizualni UI/callback pilot, **nije** dokaz stvarnog logout/login toka, RLS-a, trajnosti podataka, izvoza, sinkronizacije ni produkcijske isporuke.

Za izolirani build: `pnpm storybook:build`. Izlaz se sprema pod ignorirani `node_modules/.cache/storybook-static`, ne u produkcijski Next bundle. Za promjenu stvarnog dijaloga otvoriti zaseban Frontend zadatak; ovaj Platforma PR ne mijenja produkcijsku komponentu.

Poveznice: [Linear DAN-246](https://linear.app/daniel77/issue/DAN-246) · [izvorni nalaz #567](https://github.com/danielrisavi77-create/Ductus/issues/567).
