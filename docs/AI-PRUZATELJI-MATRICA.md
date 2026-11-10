# Matrica mogućnosti AI pružatelja (M9.1-P02)

Linear: DAN-400, plan rb 130, M9.1-P02. Datum provjere svih izvora: **10. 11. 2026.**

## 1. Svrha i granice

Dokument popisuje što pružatelji AI modela **javno objavljuju** o sedam svojstava važnih za AI pomoćnika u pilotu (M9; D-194 t. 1, 2 i 4). Svojstva su: obrada u EU, zadržavanje podataka, treniranje na podacima, alati pružatelja, zvuk (transkripcija), ugovor o obradi (DPA) i isključenje kineskih pružatelja i modela.

Granice:

- **Ovo nije izbor pružatelja.** Izbor je rb133. D-194 t. 6 (model računa) i t. 7 (najviše dva pružatelja nakon testa hrvatskog) ostaju PRIJEDLOG. Redoslijed redaka ne znači redoslijed prednosti.
- **Ovo nije ugovorno stanje.** Ductus ni operater nemaju potpisan DPA ni račun ni s jednim od ovih pružatelja. Ćelija opisuje javnu ponudu i javne uvjete na datum provjere. Pisani odgovori pružatelja koje traži D-194 t. 7 nisu ovdje.
- **Ovo nije pravno mišljenje.** Ocjena dostatnosti ide u pravno mišljenje i DPIA (D-194 t. 5).
- Retci su pružatelji koje dokumenti već spominju (D-194 t. 7, D-74, D-77). Uz njih su tri usporediva pružatelja s EU ponudom. Kineski pružatelji nemaju redak jer ih D-194 t. 2 isključuje unaprijed.

Pravila čitanja:

- Svaka ćelija ima oznaku izvora u uglatim zagradama, npr. `[MI-1]`. Izvor je javni dokument pružatelja iz registra u §4, s URL-om i datumom provjere.
- **„neprovjereno”** znači da tvrdnju javni dokument nije potvrdio na datum provjere: stranica je ne spominje, sadržaj se ne učitava bez JavaScripta ili su dva izvora u sukobu. To nije „ne”.
- Citati su doslovni, na engleskom, kako stoje u izvoru. Uvjeti se mijenjaju. Prije izbora (rb133) svaku ćeliju treba ponovno provjeriti.

## 2. Sažeta matrica

Stupci:

- **EU obrada:** može li se obrada zahtjeva vezati za EU i pod kojim uvjetom.
- **Zadržavanje:** koliko se ulaz i izlaz čuvaju i postoji li nulto zadržavanje (ZDR).
- **Treniranje:** koristi li pružatelj sadržaj kupca za treniranje modela. Ćelija navodi i iznimku za povratnu informaciju (palac gore/dolje) kad je izvor spominje. Za Bedrock, OpenRouter, OpenAI, Azure i Vertex izvori iz ćelije takvu iznimku ne navode (10. 11. 2026.).
- **Alati:** alati koje izvodi pružatelj (pretraga weba, izvršavanje koda, datoteke). D-267 O9 dopušta pretragu weba samo kroz Ductusov alat.
- **Zvuk:** postoji li transkripcija i je li njezina obrada u EU potvrđena.
- **DPA:** postoji li javni DPA i javni popis podizvršitelja.
- **Kina (D-194 t. 2):** sjedište pružatelja, nudi li modele kineskih razvijatelja i može li ih kupac isključiti.

| Pružatelj | EU obrada | Zadržavanje | Treniranje | Alati | Zvuk | DPA | Kina (D-194 t. 2) |
|---|---|---|---|---|---|---|---|
| Mistral AI (La Plateforme) | Podaci zadano u EU [MI-1]. Regionalni `api.eu.mistral.ai` (1,1×) obrađuje u podatkovnim centrima u EU i EFTA državama; samo EU: neprovjereno. Globalni endpoint ne jamči mjesto [MI-2]. | 30 dana za nadzor zloupotrebe, osim uz ZDR [MI-3]. ZDR samo za pay-as-you-go, po odobrenju i samo za endpointe bez stanja [MI-4], [MI-9] | Da, dok kupac ne isključi (opt-out) [MI-5], [MI-6]. Iznimka: povratnu informaciju (palac gore/dolje) i pripadni ulaz i izlaz Mistral koristi za treniranje i nakon opt-outa [MI-6]. Zadana postavka za pay-as-you-go: neprovjereno | Pretraga weba i izvođač koda samo kroz Agents i Conversations API (beta) [MI-7]. Na EU endpointu samo function calling [MI-2] | Da, `/v1/audio/transcriptions` [MI-8]. EU obrada transkripcije: neprovjereno | Javni DPA [MI-6]. DPA dopušta prijenos u bilo koju zemlju uz SCC [MI-6]. Popis podizvršitelja: neprovjereno [MI-10] | Sjedište Pariz [MI-6]. Modeli kineskih razvijatelja u katalogu: neprovjereno |
| Anthropic API (izravno) | Ne. Inference geo samo `us` i `global`, workspace geo samo `us` [AN-1] | Brisanje u 30 dana [AN-2]. ZDR po dogovoru s prodajom; izvršavanje koda i Files API nisu pod ZDR-om. Claude Fable 5.x i Mythos 5.x traže 30-dnevno zadržavanje, ZDR samo uz izričito odobrenje [AN-3] | Ne [AN-4]. Iznimka: izričito prijavljena povratna informacija (palac gore/dolje) može služiti za treniranje [AN-11] | Pretraga weba, dohvat weba i izvršavanje koda izvodi pružatelj [AN-5] | Transkripcija nije nađena u pregledu mogućnosti [AN-6]: neprovjereno | Javni DPA [AN-7]. Popis podizvršitelja: neprovjereno [AN-8] | Sjedište SAD; EEA ugovorna strana Anthropic Ireland [AN-9]. Nudi samo modele Claude [AN-10] |
| Anthropic preko AWS Bedrocka (EU) | Da, EU geografski profil drži zahtjev u EU [BR-1], [BR-2]. AWS upozorava da se ne treba osloniti samo na prefiks profila [BR-3] | ZDR (`none`) se postavlja po regiji, na razini računa ili projekta, i vrijedi za sve zahtjeve obuhvaćene tom postavkom; ne bira se po zahtjevu. SCP ograničava koji se način smije postaviti. Za Claude Fable 5.x obvezan `aws_review`, do 30 dana [BR-4]. Bilježenje poziva zadano isključeno [BR-5] | Ne, i sadržaj se ne dijeli s pružateljem modela [BR-6] | Alati na strani poslužitelja nisu podržani [BR-2] | Zaseban servis Amazon Transcribe u EU regijama [BR-7]. Glas može služiti za poboljšanje servisa dok se ne isključi [BR-8] | AWS DPA je dio uvjeta usluge [BR-9]. Javni popis podizvršitelja [BR-10] | Sjedište SAD; EU ugovorna strana AWS EMEA SARL [BR-11]. Katalog ima DeepSeek, Qwen, Kimi, MiniMax i GLM [BR-12]. Mogu se isključiti IAM ili SCP pravilom [BR-13] |
| OpenRouter | Djelomično. `eu.openrouter.ai` (Business i Enterprise) obrađuje u Europi: EU/EEA, UK i Švicarska [OR-1]. Samo EU/EEA uz pisani odabir dodatka DPA-u (Prilog A) [OR-2]. Podaci računa mogu biti u SAD-u [OR-1] | Ulaz se ne čuva bez uključenog bilježenja [OR-3]. ZDR vrijedi samo za usmjeravanje zahtjeva, ne za alate [OR-4] | Sam ne trenira [OR-5]. Pružatelji kojima prosljeđuje mogu trenirati; isključuje se postavkom [OR-6] | Na EU domeni nema Web Search, Web Fetch, Shell, Fusion, Image Generation ni Files; Advisor, Subagent, Datetime i Tool Search rade [OR-7] | Da, `/api/v1/audio/transcriptions` [OR-8]. EU obrada transkripcije: neprovjereno | DPA je dio uvjeta [OR-3], [OR-2]. Javni popis podizvršitelja [OR-9] | Sjedište SAD [OR-3]. Nudi DeepSeek i Qwen [OR-10]. Pružatelji se filtriraju (`only`, `ignore`) [OR-6]. Isključenje po razvijatelju modela: neprovjereno |
| OpenAI API | Da, `eu.api.openai.com` za nove projekte, uz odobrene kontrole nadzora zloupotrebe i dodatak „Modified Retention” [OA-1]. `/v1/files` i `/v1/vector_stores` nemaju regionalnu obradu [OA-1] | Dnevnici nadzora zloupotrebe do 30 dana. ZDR i izmijenjeni nadzor uz prethodno odobrenje [OA-1] | Ne, osim uz izričit pristanak kupca [OA-1] | Pretraga weba, Code Interpreter, File Search i udaljeni MCP. Podaci poslani MCP poslužitelju idu trećoj strani [OA-1] | Da (`whisper-1`, `gpt-4o-transcribe` i dr.), obrada navedena kao „United States, Europe (EEA + Switzerland)” [OA-1] | DPA i popis podizvršitelja postoje kao poveznice, ali stranice su vratile HTTP 403: neprovjereno [OA-2], [OA-3] | Sjedište: neprovjereno. Modeli kineskih razvijatelja u ponudi: neprovjereno |
| Azure OpenAI (Microsoft Foundry) | Da, uz Data Zone EU ili regionalni Standard. Global i Global Batch mogu obrađivati u bilo kojoj geografiji; Data Zone Batch ostaje u zoni [AZ-1]. EU zona može uključiti EFTA države [AZ-1] | Označeni upiti čuvaju se u geografiji resursa. Isključenje nadzora uz Limited Access odobrenje [AZ-2], [AZ-3]. Broj dana: neprovjereno | Ne, bez dopuštenja ili uputa kupca [AZ-3] | Grounding with Bing izlazi iz Azure granice i nije pod DPA-om [AZ-4] | Da (`whisper`, `gpt-4o-transcribe` i dr.) [AZ-5]. U EU regijama `gpt-4o-transcribe` i `whisper` [AZ-6] | Javni Microsoft DPA [AZ-7], [AZ-3]. Javni popis podizvršitelja [AZ-8] | Sjedište: neprovjereno. Katalog ima modele Qwen3 [AZ-5]. Zabrana kroz Azure Policy [AZ-9] |
| Google Vertex AI (Gemini) | Da, multi-regija `eu` ili pojedinačna EU regija. Globalni endpoint ne jamči mjesto [GV-1]. Za mogućnosti koje nisu navedene nema jamstva lokacije [GV-2] | Predmemorija se briše najkasnije za 24 h i može se isključiti [GV-3]. Uvjeti ZDR-a u [GV-4] | Ne, bez prethodnog dopuštenja ili uputa kupca [GV-3] | Grounding with Google Search čuva podatke do 3 dana bez mogućnosti isključenja [GV-3]. Nije podržan za rezidenciju [GV-2] | Chirp 3 (Speech-to-Text) u multi-regiji `eu` [GV-5]. Izjava o rezidenciji za Speech-to-Text: neprovjereno [GV-6] | DPA je dio ugovora [GV-7]. Javni popis podizvršitelja [GV-8] | Sjedište: neprovjereno. Katalog ima DeepSeek [GV-9]. Zabrana kroz pravilo organizacije `vertexai.allowedModels` [GV-10] |

## 3. Pojedinosti po pružatelju

### 3.1 Mistral AI (La Plateforme)

- **EU obrada.** Pomoćna stranica kaže da su podaci zadano u EU [MI-1]. Stranica o regionalnom inferenceu kaže da globalni endpoint ne jamči mjesto obrade [MI-2]. Izvori se ne podudaraju pa je obrada na globalnom endpointu **neprovjerena**. Regionalni `api.eu.mistral.ai` obrađuje u „Multiple data centers in EU and EFTA countries” [MI-2], pa obrada isključivo u EU nije potvrđena: **neprovjereno**. Na tom endpointu nisu dostupni Agents, Batch i Files, a od alata radi samo function calling [MI-2].
- **Zadržavanje.** Ulaz i izlaz čuvaju se 30 dana radi nadzora zloupotrebe, osim uz ZDR [MI-3]. ZDR se odobrava „at our discretion” i samo za pay-as-you-go [MI-4]. Iz ZDR-a su isključeni conversations, libraries, `/v1/files` [MI-4] i Labs modeli [MI-9]. Po DPA-u, podaci nakon prestanka ugovora više nisu dostupni nakon 30 dana [MI-6].
- **Treniranje.** DPA dopušta treniranje „unless Customer is or has opted-out of training” [MI-6]. Za pay-as-you-go kupac ima „the right to opt out at any time” [MI-5]. Zadana postavka nije navedena: **neprovjereno**. Iznimka koju opt-out ne isključuje: ako kupac da povratnu informaciju „by using the in-app "thumbs up" or "thumbs down" features”, Mistral „will use such Feedback as well as the associated Input and Output, as Controller, to train its artificial intelligence models” [MI-6].
- **DPA.** Prijenos „to any country” je dopušten uz standardne ugovorne klauzule [MI-6]. Popis podizvršitelja učitava se tek uz JavaScript i nije pročitan [MI-10].

### 3.2 Anthropic API (izravno)

- **EU obrada.** Nema je. Dokumentacija o rezidenciji podataka navodi samo `us` i `global` za inference, a za workspace samo `us` [AN-1]. To odgovara tvrdnji iz D-194 t. 7.
- **Zadržavanje.** Zadano brisanje u 30 dana [AN-2]. ZDR se dogovara s prodajom. Izvršavanje koda i Files API nisu pokriveni ZDR-om, a pretraga i dohvat weba jesu [AN-3]. Claude Fable 5, 5.1 i 5.2 te Mythos 5, 5.1 i 5.2 „require 30-day data retention; ZDR is therefore not available for any of them unless expressly authorized by Anthropic”; zahtjev organizacije bez uključenog zadržavanja vraća `400 invalid_request_error` [AN-3].
- **Treniranje.** „Anthropic may not train models on Customer Content from Services” [AN-4]. Za komercijalne proizvode, uključujući Anthropic API, Privacy Center dodaje iznimku: „If you explicitly report feedback or bugs to us (e.g. via our thumbs up/down feedback button), or otherwise choose to allow us to use your data, then we may use your chats and coding sessions to train our models” [AN-11]. Takva povratna informacija čuva se do 5 godina, a vlasnik Team ili Enterprise organizacije može isključiti gumb [AN-11].
- **Alati.** Alate `web_search`, `web_fetch` i `code_execution` izvodi Anthropic na svojoj infrastrukturi [AN-5]. Zbog D-267 O9 pretraga weba pružatelja nije put za Ductus.

### 3.3 Anthropic preko AWS Bedrocka (EU)

- **EU obrada.** Zahtjevi na geografski inference profil (US, EU, APAC) ostaju u toj geografiji [BR-1]. EU regije za Claude navedene su u [BR-2]. Obrada samo unutar jedne regije nudi se u `eu-north-1` i `eu-west-1`, uz 10 % višu cijenu [BR-2]. AWS upozorava: „Don't rely on the geographic prefix in an inference profile ID alone” [BR-3].
- **Zadržavanje.** Način se postavlja „in a given AWS Region at the account level or project level”; postavka „governs every request in the Region where you set it and does not propagate to other Regions” [BR-4]. Vrijedi prva postavka koja nije `inherit`, redom projekt, račun, zadana postavka modela [BR-4]. Projekti postoje samo na `bedrock-mantle`; zahtjevi na `bedrock-runtime` slijede postavku računa u regiji [BR-4]. Način `none`: „No request or response data is written to durable storage by AWS or shared with the model provider” [BR-4]. Modeli Claude Fable 5, 5.1 i 5.2 traže način `aws_review`, s čuvanjem do 30 dana [BR-4]. SCP može ograničiti koji se način smije postaviti: ključ `bedrock-mantle:DataRetentionMode` za `bedrock-mantle:PutAccountDataRetention`, `CreateProject` i `UpdateProject`, a `bedrock:DataRetentionMode` za `bedrock:PutAccountDataRetention` na kontrolnoj ravnini [BR-4].
- **Alati.** Bedrock ne podržava alate na strani poslužitelja (izvršavanje koda, pretraga i dohvat weba), Files API ni MCP konektor [BR-2].
- **Zvuk.** Amazon Transcribe je zaseban servis [BR-7]. Skupna i streaming transkripcija dostupne su u regijama `eu-central-1`, `eu-central-2`, `eu-west-1` i `eu-west-2`, a samo skupna u `eu-north-1` i `eu-west-3` [BR-7]. Transcribe „may store and use voice inputs” za poboljšanje servisa. Dio sadržaja može se čuvati i u drugoj regiji, dok se ne uključi AWS Organizations opt-out pravilo [BR-8].
- **Kina.** Modeli kineskih razvijatelja nalaze se u istom katalogu [BR-12]. „Access to many Amazon Bedrock foundation models is enabled by default.” Pristup se uskraćuje IAM ili SCP pravilom koje zabranjuje `bedrock:InvokeModel` po ID-u modela [BR-13].

### 3.4 OpenRouter

- **EU obrada.** `eu.openrouter.ai`, samo za Business i Enterprise, usmjerava na endpointe u Europi, „the EU/EEA, the UK, and Switzerland” [OR-1]. Užu obradu, „processed and stored exclusively in EU/EEA-region infrastructure”, daje Prilog A DPA-u, koji „applies only where Customer has elected EU-only Processing … as indicated in the applicable Order Form or other written agreement” [OR-2]; bez tog odabira Prilog A ne vrijedi [OR-2]. Ako nijedan endpoint u regiji ne može poslužiti zahtjev, „it errors instead of leaving the region” [OR-1]. Podaci računa, naplate i prijave mogu se obrađivati u SAD-u [OR-1]. Zadano je hosting na Google Cloudu u SAD-u [OR-2]. D-77 se na to odnosi za osobne račune.
- **Zadržavanje i treniranje.** OpenRouter sam ne čuva ulaz bez uključenog bilježenja [OR-3] i ne trenira [OR-5]. Pružatelji kojima prosljeđuje mogu trenirati, osim uz opt-out na računu ili `data_collection: "deny"` [OR-6]. ZDR se odnosi samo na usmjeravanje zahtjeva, ne na dodatke i alate [OR-4].
- **Kina.** Katalog sadrži modele DeepSeek i Qwen [OR-10]. Postavke `only` i `ignore`, po zahtjevu i na računu, filtriraju pružatelje koji poslužuju model, ne razvijatelja modela [OR-6]. Pravilo po razvijatelju modela, kakvo traži D-194 t. 2: **neprovjereno**.

### 3.5 OpenAI API

- **EU obrada.** Europa (EEA i Švicarska) bira se kao postavka novog projekta i koristi `eu.api.openai.com`. Za obradu izvan SAD-a „you must be approved for abuse monitoring controls, and execute a Modified Retention amendment” [OA-1]. „Support for regional storage does not imply support for regional processing” [OA-1].
- **Zadržavanje.** „By default, abuse monitoring logs are generated for all API feature usage and retained for up to 30 days” [OA-1]. ZDR i izmijenjeni nadzor podliježu „prior approval by OpenAI” [OA-1].
- **DPA.** Stranice DPA-a i popisa podizvršitelja vratile su HTTP 403 pa nisu pročitane: **neprovjereno** [OA-2], [OA-3]. Sjedište nije provjereno iz istog razloga.

### 3.6 Azure OpenAI (Microsoft Foundry)

- **EU obrada.** Za Data Zone: „The service processes data only within the Microsoft-specified data zone (US, EU, or Asia Pacific (APAC))” [AZ-1]. Global i Global Batch mogu obrađivati u bilo kojoj Azure regiji, Data Zone Batch ostaje „Within data zone”, a Developer razina nema jamstvo rezidencije [AZ-1].
- **Zadržavanje.** Isključenje nadzora zloupotrebe traže „customers who meet additional Limited Access eligibility criteria” [AZ-2]. Nakon odobrenja pohrana i ljudski pregled „is not performed” [AZ-3].
- **Alati.** „The Microsoft Data Protection Addendum doesn't apply to data sent to Grounding with Bing Search” [AZ-4].
- **Kina.** Katalog modela koje prodaje Azure sadrži modele Qwen3 [AZ-5]. Nedopuštena postavljanja modela zabranjuju se prilagođenim Azure Policy pravilom [AZ-9].

### 3.7 Google Vertex AI (Gemini)

- **EU obrada.** „The European Union multi-region (`eu`) endpoint strictly covers data residency within EU member states” [GV-1]. Pokrivenost ovisi o modelu [GV-1]. Za mogućnost koja nije navedena „ML processing is not guaranteed to occur in a specific location” [GV-2]. Tablica [GV-2] za dio modela i regionalnih endpointa djelomično se razlikuje od [GV-1]: **neprovjereno**.
- **Alati.** Grounding with Google Search čuva podatke do 3 dana: „There is no way to disable the storage of this information” [GV-3]. Za rezidenciju je „Not supported” [GV-2].
- **Kina.** „DeepSeek models are available for use as managed APIs” [GV-9]. Pravilo organizacije ograničava dostupne modele [GV-10].


## 4. Registar izvora

Svi izvori su provjereni 10. 11. 2026. Stupac „Kaže” bilježi samo ono na čemu ćelija počiva.

| ID | Izvor (URL) | Kaže |
|---|---|---|
| MI-1 | https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data | „By default, your data is hosted in the European Union”; US endpoint se bira izričito |
| MI-2 | https://docs.mistral.ai/inference/regional-inference | Globalni endpoint: „Mistral does not commit to a specific inference location”; `api.eu.mistral.ai`; „Multiple data centers in EU and EFTA countries”; cijena 1,1×; na regionalnom endpointu samo function calling, bez Agents, Batch i Files |
| MI-3 | https://legal.mistral.ai/terms/privacy-policy/ | Ulaz i izlaz „for thirty (30) rolling days to monitor abuse (unless zero data retention is activated)” |
| MI-4 | https://help.mistral.ai/en/articles/347612-can-i-activate-zero-data-retention-zdr | ZDR samo za pay-as-you-go, „at our discretion”, samo endpointi bez stanja |
| MI-5 | https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models | Pay-as-you-go: „the right to opt out at any time”; zadana postavka nije navedena |
| MI-6 | https://legal.mistral.ai/terms/data-processing-addendum | §2.3 treniranje „unless Customer is or has opted-out”; §2.3 povratna informacija „thumbs up” ili „thumbs down” s pripadnim ulazom i izlazom služi za treniranje; §8.1 prijenos „to any country” uz SCC; §10.1 30 dana nakon prestanka; sjedište „15 rue des Halles, 75001 Paris, France” |
| MI-7 | https://docs.mistral.ai/studio/agents/agent-tools | `web_search` i `code_interpreter` „aren't supported in the Chat Completions API”; samo Agents i Conversations |
| MI-8 | https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-files | `POST /v1/audio/transcriptions`, modeli `voxtral-*-transcribe-3` |
| MI-9 | https://docs.mistral.ai/admin/monitor-comply/zero-data-retention | ZDR pokriva `/v1/audio/transcriptions`; Labs modeli su izuzeti |
| MI-10 | https://trust.mistral.ai/subprocessors | Popis se učitava tek uz JavaScript i nije pročitan: neprovjereno |
| AN-1 | https://platform.claude.com/docs/en/manage-claude/data-residency | „Inference geo: Only "us" and "global" are available.”; „Workspace geo: Only "us" is currently available.” |
| AN-2 | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data | Zadano brisanje u 30 dana |
| AN-3 | https://platform.claude.com/docs/en/manage-claude/api-and-data-retention | ZDR po dogovoru; izvršavanje koda i Files API nisu pod ZDR-om; Claude Fable 5.x i Mythos 5.x traže 30 dana zadržavanja, ZDR samo uz izričito odobrenje |
| AN-4 | https://www.anthropic.com/legal/commercial-terms | „Anthropic may not train models on Customer Content from Services” |
| AN-5 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview | Alate na strani poslužitelja izvodi Anthropic |
| AN-6 | https://platform.claude.com/docs/en/build-with-claude/overview | U pregledu mogućnosti nema transkripcije zvuka |
| AN-7 | https://www.anthropic.com/legal/data-processing-addendum | Javni DPA, uključen u komercijalne uvjete |
| AN-8 | https://trust.anthropic.com/subprocessors | Popis se učitava tek uz JavaScript i nije pročitan: neprovjereno |
| AN-9 | https://www.anthropic.com/legal/privacy | Sjedište San Francisco; za EEA Anthropic Ireland, Limited |
| AN-10 | https://platform.claude.com/docs/en/models/overview | Popis modela sadrži samo modele Claude |
| AN-11 | https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training | Komercijalni proizvodi (uklj. Anthropic API) zadano bez treniranja; izričito prijavljena povratna informacija (palac gore/dolje) može služiti za treniranje; čuvanje do 5 godina; isključenje gumba za Team i Enterprise |
| BR-1 | https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html | Zahtjevi na geografski profil „stay within that geography” |
| BR-2 | https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock | EU regije; obrada u jednoj regiji u `eu-north-1` i `eu-west-1` uz 10 %; bez alata na strani poslužitelja, Files API i MCP konektora |
| BR-3 | https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html | „Don't rely on the geographic prefix in an inference profile ID alone” |
| BR-4 | https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html | Način `none` (ZDR) po regiji, na razini računa ili projekta, ne po zahtjevu; Claude Fable 5.x traži `aws_review` do 30 dana; ključevi `bedrock-mantle:DataRetentionMode` i `bedrock:DataRetentionMode` za SCP |
| BR-5 | https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html | „Model invocation logging is disabled by default” |
| BR-6 | https://aws.amazon.com/bedrock/faqs/ | „your content is not used to improve the base models and is not shared with any model providers” |
| BR-7 | https://docs.aws.amazon.com/general/latest/gr/transcribe.html#transcribe_region | Regije Amazon Transcribea, skupno i streaming |
| BR-8 | https://aws.amazon.com/transcribe/faqs/ | „may store and use voice inputs … to improve”; opt-out kroz AWS Organizations pravilo |
| BR-9 | https://aws.amazon.com/service-terms/ | §1.14.1 „These Service Terms incorporate the AWS Data Processing Addendum” |
| BR-10 | https://aws.amazon.com/compliance/sub-processors/ | Javni popis podizvršitelja, ovisi o regiji |
| BR-11 | https://aws.amazon.com/agreement/ | Ugovorna strana za EU: Amazon Web Services EMEA SARL, Luksemburg |
| BR-12 | https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html | Katalog s modelima DeepSeek, Qwen, Moonshot Kimi, MiniMax i Z.AI GLM |
| BR-13 | https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html | „Access to many Amazon Bedrock foundation models is enabled by default.”; zabrana kroz IAM ili SCP |
| OR-1 | https://openrouter.ai/docs/guides/features/in-region-routing | `eu.openrouter.ai` samo za Business i Enterprise; Europa je „the EU/EEA, the UK, and Switzerland”; „it errors instead of leaving the region”; podaci računa mogu biti u SAD-u |
| OR-2 | https://openrouter.ai/data-processing-agreement | Prilog A: EU API „processed and stored exclusively in EU/EEA-region infrastructure”, samo uz pisani odabir u narudžbenici ili drugom ugovoru; zadano Google Cloud u SAD-u |
| OR-3 | https://openrouter.ai/terms | §6.5 „we do not store your Inputs” bez uključenog bilježenja; §10.2 DPA je dio uvjeta; §22 sjedište New York |
| OR-4 | https://openrouter.ai/docs/guides/features/zdr | „ZDR enforcement only applies to provider routing for inference requests” |
| OR-5 | https://openrouter.ai/privacy | „OpenRouter does not use your Inputs or Outputs for model training.” |
| OR-6 | https://openrouter.ai/docs/guides/routing/provider-selection | Pružatelji modela mogu trenirati; `data_collection: "deny"`; `only` i `ignore` po pružatelju |
| OR-7 | https://openrouter.ai/docs/guides/features/server-tools | Matrica alata: EU stupac „None” za Web Search i Web Fetch, „No” za Shell, Fusion, Image Generation i Files; „Yes” za Apply Patch, Advisor, Subagent, Datetime, Tool Search i Search Models |
| OR-8 | https://openrouter.ai/docs/guides/overview/multimodal/stt | `/api/v1/audio/transcriptions` |
| OR-9 | https://trust.openrouter.ai/ | Popis podizvršitelja (npr. Cloudflare, ClickHouse, Clerk) |
| OR-10 | https://openrouter.ai/deepseek i https://openrouter.ai/qwen | Modeli `deepseek/deepseek-r1`, `deepseek/deepseek-v3.2`, `qwen/qwen3-max` |
| OA-1 | https://developers.openai.com/api/docs/guides/your-data | EU projekt i `eu.api.openai.com` uz „Modified Retention amendment”; 30 dana dnevnika; „not used to train or improve OpenAI models”; alati i regije; transkripcija u SAD-u i Europi |
| OA-2 | https://openai.com/policies/data-processing-addendum/ | HTTP 403 na datum provjere: neprovjereno |
| OA-3 | https://openai.com/policies/sub-processor-list/ | HTTP 403 na datum provjere: neprovjereno |
| AZ-1 | https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/concepts/deployment-types | Data Zone EU; Global i Global Batch „Any Azure region”; Data Zone Batch „Within data zone” |
| AZ-2 | https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring | Isključenje nadzora uz Limited Access |
| AZ-3 | https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy | „NOT used to train any generative AI foundation models without your permission or instruction”; DPA uređuje obradu |
| AZ-4 | https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/web-overview | DPA se ne primjenjuje na Grounding with Bing; podaci izlaze iz granice |
| AZ-5 | https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure | Modeli za transkripciju; Qwen3 u katalogu |
| AZ-6 | https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability | `gpt-4o-transcribe` u EU Data Zone (francecentral, swedencentral); `whisper` u swedencentral i westeurope |
| AZ-7 | https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA | „The DPA is an addendum to the Product Terms site” |
| AZ-8 | https://go.microsoft.com/fwlink/?linkid=2096306 | Popis podizvršitelja, poveznica s https://www.microsoft.com/en-us/trust-center/privacy/data-access |
| AZ-9 | https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/how-to/configure-deployment-policies | Azure Policy „denies non-approved model deployments” |
| GV-1 | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency | Multi-regija `eu` „strictly covers data residency within EU member states”; globalni endpoint bez jamstva |
| GV-2 | https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/supported-capabilities | Mogućnost koja nije navedena nema jamstvo lokacije; Grounding with Google Search „Not supported” |
| GV-3 | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance | Predmemorija do 24 h; „won't use your data to train or fine-tune”; pretraga čuva do 3 dana bez isključenja |
| GV-4 | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention | Uvjeti ZDR-a |
| GV-5 | https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3 | `chirp_3` u „eu (multi-region)” |
| GV-6 | https://docs.cloud.google.com/speech-to-text/docs/locations | Nema izričite izjave o rezidenciji obrade |
| GV-7 | https://cloud.google.com/terms/data-processing-addendum | DPA „is incorporated into the Agreement(s)” |
| GV-8 | https://cloud.google.com/terms/subprocessors | Javni popis podizvršitelja |
| GV-9 | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/maas/deepseek | „DeepSeek models are available for use as managed APIs” |
| GV-10 | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/control-model-access | Pravilo organizacije „lets you centrally control the models your users can access” |

## 5. Neprovjereno i otvoreno

Ove stavke treba potvrditi pisanim odgovorom pružatelja prije izbora (D-194 t. 7). Popis nije prioritet.

1. Mistral: gdje se obrađuju zahtjevi na globalnom endpointu [MI-1] naspram [MI-2], i može li se regionalna obrada ograničiti na EU bez EFTA država [MI-2].
2. Mistral: zadana postavka treniranja za pay-as-you-go [MI-5].
3. Mistral, OpenRouter: obrada transkripcije u EU [MI-8], [OR-8].
4. Mistral, Anthropic: sadržaj popisa podizvršitelja [MI-10], [AN-8].
5. Mistral: ima li katalog modele kineskih razvijatelja.
6. Anthropic izravno: transkripcija zvuka [AN-6].
7. OpenRouter: isključenje modela po razvijatelju, ne samo po pružatelju [OR-6].
8. OpenAI: tekst DPA-a, popis podizvršitelja i sjedište (stranice su vratile HTTP 403) [OA-2], [OA-3].
9. Azure: broj dana čuvanja označenih upita [AZ-2].
10. Vertex: razlika između [GV-1] i [GV-2] za dio modela; rezidencija transkripcije [GV-6].
11. OpenAI, Azure, Vertex: sjedište iz javnog dokumenta pružatelja.
12. Svi: obrada pri pozivu vlastitog Ductusova alata za pretragu (D-267 O9) nije predmet ove matrice.

Za svakog pružatelja `docs/privacy/04` traži i ugovornu stranu i grupu, zemlju, rok čuvanja, treniranje, podizvršitelje i dob korisnika. Dob korisnika ova matrica ne pokriva.
