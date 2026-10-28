export default function PrototypeMarkup() {
  return (<>
<header>
  <div className={"wrap header-inner"}>
    <a className={"brand"} href={"#vrh"} aria-label={"Ductura, početak"}>{"ductura"}
      <span>{"."}</span>
    </a>
    <div className={"brand-meta"}>{"Prostor za"}
      <br />{"akademski rad"}
    </div>
    <button className={"menu"} type={"button"} aria-expanded={"false"} aria-controls={"navigation"}>{"Izbornik"}</button>
    <nav id={"navigation"} aria-label={"Glavna navigacija"}>
      <a href={"#mogucnosti"}>{"Mogućnosti"}</a>
      <a href={"#studenti"}>{"Za studente"}</a>
      <a href={"#fakulteti"}>{"Za fakultete"}</a>
      <a href={"#povjerenje"}>{"Povjerenje"}</a>
      <a href={"#sve-mogucnosti"}>{"Cjeloviti pregled"}</a>
      <a className={"nav-cta"} href={"#kontakt"}>{"Za fakultete "}<span aria-hidden={true} className={"arrow-up-right"} /></a>
      <a href={"/prijava"} className={"login-link"}>{"Prijava"}</a>
    </nav>
  </div>
</header>
<main id={"sadrzaj"} tabIndex={-1}>
  <section className={"hero"} id={"vrh"} aria-labelledby={"hero-title"}>
    <div className={"wrap hero-grid"}>
      <div className={"hero-copy"}>
        <p className={"smallcaps"}>{"Za fakultete diljem Hrvatske"}</p>
        <h1 id={"hero-title"}>{"Jedan rad."}
          <br />{"Dva "}
          <em>{"pogleda."}</em>
        </h1>
        <p className={"hero-deck"}>{"Prostor za akademsko pisanje u kojem student razvija rad, nastavnik daje povratne informacije, a upute ustanove ostaju uz tekst."}</p>
        <div className={"actions"}>
          <a className={"primary"} href={"#primjer"}>{"Isprobajte jedan rad "}
            <span aria-hidden={"true"}><span aria-hidden={true} className={"arrow-up-right"} /></span>
          </a>
          <a className={"secondary"} href={"#kontakt"}>{"Razgovarajmo o Ducturi"}</a>
          <a className={"secondary"} href={"/prijava"}>{"Prijavi se i počni"}</a>
        </div>
        <p className={"hero-foot"}>
          <span>
            <b>{"Proizvod u razvoju."}</b>{" Istražite viziju Ducture."}
          </span>
        </p>
      </div>
      <div className={"stage"} id={"primjer"} aria-label={"Interaktivni primjer studentskog rada"}>
        <div className={"stage-controls"}>
          <div className={"stage-switch"} role={"group"} aria-label={"Odaberite perspektivu"}>
            <button type={"button"} id={"student-view"} aria-pressed={"true"}>{"Student"}</button>
            <button type={"button"} id={"mentor-view"} aria-pressed={"false"}>{"Nastavnik"}</button>
          </div>
          <p className={"stage-help"}>{"Pišite, komentirajte i doradite. Prikaz ostaje u pregledniku dok je stranica otvorena."}</p>
        </div>
        <div className={"sheet-back"} aria-hidden={"true"}></div>
        <div className={"sheet"}>
          <div className={"sheet-bar"}>
            <span className={"sheet-wordmark"}>{"ductura."}</span>
            <span className={"sheet-bar-note"}>{"Interaktivni prikaz"}</span>
          </div>
          <div className={"journey-bar"}>
            <ol className={"journey-steps"} aria-label={"Koraci rada"}>
              <li data-journey-step={"1"} aria-current={"step"}>
                <b>{"1"}</b>{" Pišite"}
              </li>
              <li data-journey-step={"2"}>
                <b>{"2"}</b>{" Komentirajte"}
              </li>
              <li data-journey-step={"3"}>
                <b>{"3"}</b>{" Doradite"}
              </li>
            </ol>
            <p>{"Jedan rad, od misli do povratne informacije."}</p>
          </div>
          <div className={"sheet-layout"}>
            <div className={"paper-body"}>
              <p className={"paper-status"} id={"paper-status"}>{"Studentski pogled / Nacrt"}</p>
              <p className={"paper-num"} aria-hidden={"true"}>{"01"}</p>
              <h2 className={"paper-title"}>{"Kako nastaje zajednička odluka?"}</h2>
              <p className={"paper-caption"} id={"paper-caption"}>{"Promijenite tekst i pogledajte ga očima nastavnika."}</p>
              <div className={"dual-writing"}>
                <div className={"dual-edit"}>
                  <label htmlFor={"sample-text"} className={"smallcaps"} id={"sample-label"}>{"Vaš tekst"}</label>
                  <textarea className={"sample-input"} id={"sample-text"} spellCheck={"false"} defaultValue={"Razgovor može pomoći sudionicima da razumiju različite mogućnosti. Pitanje je kako taj proces utječe na donošenje zajedničke odluke."}></textarea>
                  <div className={"sample-read"} id={"sample-read"} aria-label={"Isti tekst u pogledu nastavnika"} hidden></div>
                </div>
                <section className={"live-mirror"} id={"mentor-live"} aria-label={"Istodobni primjer pogleda nastavnika"}>
                  <div className={"mirror-heading"}>
                    <span>{"Nastavnik"}</span>
                    <b>{"Isti rad"}</b>
                  </div>
                  <p id={"mirror-text"} className={"mirror-text"}>{"Razgovor može pomoći sudionicima da razumiju različite mogućnosti. Pitanje je kako taj proces utječe na donošenje zajedničke odluke."}</p>
                  <p className={"mirror-hint"}>{"Pogled nastavnika"}</p>
                  <p className={"mirror-comment"} id={"mirror-comment"} hidden></p>
                </section>
              </div>
              <p className={"paper-words"} id={"paper-words"}></p>
            </div>
            <aside className={"paper-note"} aria-label={"Margina primjera"}>
              <div id={"student-note"}>
                <p className={"smallcaps"}>{"Povratna informacija"}</p>
                <p className={"margin-marker"} aria-hidden={"true"}>{"„"}</p>
                <h3 className={"note-title"}>{"Komentar uz odlomak."}</h3>
                <p className={"note-copy"}>{"U nastavničkom pogledu odaberite odlomak i napišite komentar."}</p>
                <div className={"comment-result"} id={"comment-result"} hidden>
                  <strong>{"Komentar"}</strong>
                  <span id={"comment-value"}></span>
                  <small id={"comment-anchor-preview"}></small>
                </div>
                <p className={"flow-hint"} id={"flow-revision-hint"} hidden>{"Doradite tekst uz komentar i usporedite obje verzije."}</p>
                <details className={"flow-review"} id={"flow-review"} hidden>
                  <summary>{"Usporedite prije i poslije"}</summary>
                  <dl>
                    <dt>{"Prije komentara"}</dt>
                    <dd id={"flow-before"}></dd>
                    <dt>{"Vaša dorada"}</dt>
                    <dd id={"flow-after"}></dd>
                  </dl>
                </details>
                <button className={"flow-button"} type={"button"} id={"flow-to-mentor"}>{"Nastavite na komentar "}<span aria-hidden={true} className={"arrow-right"} /></button>
                <button className={"flow-button flow-secondary"} type={"button"} id={"flow-replay"} hidden>{"Pogledajte promjene "}<span aria-hidden={true} className={"arrow-right"} /></button>
              </div>
              <div id={"mentor-note"} hidden>
                <p className={"smallcaps"}>{"Nastavnički pogled"}</p>
                <p className={"margin-marker"} aria-hidden={"true"}>{"„"}</p>
                <h3 className={"note-title"}>{"Što biste pitali?"}</h3>
                <p className={"note-copy"}>{"Odaberite odlomak i ostavite povratnu informaciju."}</p>
                <form className={"comment-form"} id={"comment-form"}>
                  <label htmlFor={"comment-anchor"}>{"Odaberite odlomak"}</label>
                  <select id={"comment-anchor"} aria-label={"Odlomak uz komentar"}></select>
                  <label htmlFor={"comment-text"}>{"Komentar"}</label>
                  <textarea id={"comment-text"} maxLength={300} placeholder={"Možete li navesti primjer?"}></textarea>
                  <button type={"submit"}>{"Dodaj komentar"}</button>
                </form>
                <button className={"flow-button flow-secondary"} type={"button"} id={"flow-to-student"} hidden>{"Vratite se doradi "}<span aria-hidden={true} className={"arrow-right"} /></button>
              </div>
            </aside>
          </div>
        </div>
        <p role={"status"} id={"demo-status"} className={"paper-words"} style={{"color": "#e7cde1"}}></p>
      </div>
    </div>
  </section>
  <div className={"ribbon"}>
    <div className={"wrap ribbon-inner"}>
      <span className={"smallcaps"}>{"Jedan zajednički rad"}</span>
      <p>{"Student piše. Nastavnik komentira."}</p>
      <a href={"#ideja"}>{"Otkrijte Ducturu "}<span aria-hidden={true} className={"arrow-down"} /></a>
    </div>
  </div>
  <section className={"intro"} id={"ideja"}>
    <div className={"wrap intro-grid"}>
      <div className={"intro-left"}>
        <p className={"smallcaps"}>{"Prostor za akademski rad"}</p>
        <p>{"Pisanje, izvori i razgovor na jednom mjestu."}</p>
      </div>
      <div>
        <h2>{"Prostor za rad."}
          <br />
          <em>{"Prostor za razgovor."}</em>
        </h2>
        <p className={"intro-lead"}>{"Ductura povezuje tekst, upute, izvore i komentare uz isti zadatak. Student i nastavnik mogu pratiti kako se rad mijenja od nacrta do predaje."}</p>
        <div className={"duo"}>
          <article>
            <h3>{"Za studenta"}</h3>
            <p>{"Upute, bilješke, izvori i povratne informacije dostupni su uz tekst koji piše."}</p>
          </article>
          <article>
            <h3>{"Za fakultet"}</h3>
            <p>{"Nastavnik postavlja zadatak i daje komentare u kontekstu rada, uz pravila ustanove."}</p>
          </article>
        </div>
      </div>
    </div>
  </section>
  <section className={"atlas"} id={"mogucnosti"} aria-labelledby={"atlas-title"}>
    <div className={"wrap"}>
      <div className={"atlas-head"}>
        <p className={"smallcaps"}>{"Istražite Ducturu"}</p>
        <div>
          <h2 id={"atlas-title"}>{"Pogledajte što prati "}
            <em>{"jedan rad."}</em>
          </h2>
          <p className={"atlas-lead"}>{"Odaberite područje i isprobajte kako bi pisanje, izvori, mentorstvo i predaja mogli funkcionirati zajedno."}</p>
          <p className={"atlas-label"}>{"Interaktivni prikazi · tekst i komentari ostaju u pregledniku"}</p>
        </div>
      </div>
      <div className={"atlas-tabs"} role={"tablist"} aria-label={"Područja Ducture"}>
        <button className={"atlas-tab"} role={"tab"} id={"tab-pisanje"} aria-controls={"panel-pisanje"} aria-selected={"true"} tabIndex={0}>{"Pisanje"}</button>
        <button className={"atlas-tab"} role={"tab"} id={"tab-izvori"} aria-controls={"panel-izvori"} aria-selected={"false"} tabIndex={-1}>{"Izvori"}</button>
        <button className={"atlas-tab"} role={"tab"} id={"tab-mentorstvo"} aria-controls={"panel-mentorstvo"} aria-selected={"false"} tabIndex={-1}>{"Mentorstvo"}</button>
        <button className={"atlas-tab"} role={"tab"} id={"tab-proces"} aria-controls={"panel-proces"} aria-selected={"false"} tabIndex={-1}>{"Nastanak rada"}</button>
        <button className={"atlas-tab"} role={"tab"} id={"tab-predaja"} aria-controls={"panel-predaja"} aria-selected={"false"} tabIndex={-1}>{"Predaja i obrana"}</button>
        <button className={"atlas-tab"} role={"tab"} id={"tab-asistent"} aria-controls={"panel-asistent"} aria-selected={"false"} tabIndex={-1}>{"AI pomoćnik"}</button>
        <button className={"atlas-tab"} role={"tab"} id={"tab-ustanova"} aria-controls={"panel-ustanova"} aria-selected={"false"} tabIndex={-1}>{"Ustanova"}</button>
      </div>
      <section className={"atlas-panel"} role={"tabpanel"} id={"panel-pisanje"} aria-labelledby={"tab-pisanje"} tabIndex={0}>
        <div className={"atlas-info"}>
          <p className={"index"}>{"01 / 07"}</p>
          <h3>{"Od pitanja do pristupa"}</h3>
          <p>{"Razmotrite različite pristupe i zabilježite zašto ste ih odabrali. Struktura rada i upute ostaju uz tekst."}</p>
          <ul>
            <li>
              <span>{"01"}</span>{" Akademski uređivač i struktura rada"}
            </li>
            <li>
              <span>{"02"}</span>{" Vodič kroz metodološka pitanja"}
            </li>
            <li>
              <span>{"03"}</span>{" Bilješke o istraživačkim odlukama"}
            </li>
            <li>
              <span>{"04"}</span>{" Pravila, rokovi i stanje spremanja"}
            </li>
          </ul>
        </div>
        <div className={"vision-sheet lab-sheet"}>
          <div className={"vision-head"}>
            <strong>{"Radni stol"}</strong>
            <span>{"Radni prostor"}</span>
          </div>
          <div className={"lab-main"}>
            <p className={"lab-kicker"}>{"Istraživačko pitanje"}</p>
            <h4 className={"lab-question"}>{"Kako studenti doživljavaju sudjelovanje u odlučivanju?"}</h4>
            <p className={"lab-copy"}>{"Odaberite pristup i usporedite pitanja koja si istraživač može postaviti."}</p>
            <div className={"lab-segment"} role={"group"} aria-label={"Odabir pristupa u primjeru"}>
              <button type={"button"} data-method={"intervju"} aria-pressed={"true"}>{"Intervjui"}</button>
              <button type={"button"} data-method={"anketa"} aria-pressed={"false"}>{"Anketa"}</button>
            </div>
            <div className={"lab-explanation"} id={"method-explanation"} aria-live={"polite"}>
              <strong>{"Razgovor o iskustvima"}</strong>
              <p>{"Intervjui mogu otvoriti prostor za detaljnije razumijevanje iskustava pojedinaca."}</p>
              <span>{"Za razmišljanje: koga uključiti i kako analizirati odgovore?"}</span>
            </div>
            <details className={"lab-disclosure"}>
              <summary>{"Zabilježite vlastitu odluku"}</summary>
              <label className={"lab-label"} htmlFor={"decision-text"}>{"Zašto biste odabrali ovaj pristup?"}</label>
              <textarea id={"decision-text"} rows={2} maxLength={240} placeholder={"U primjeru sam odabrao/la ovaj pristup jer..."}></textarea>
              <button className={"lab-action"} type={"button"} id={"decision-add"}>{"Zabilježite odluku"}</button>
              <p className={"lab-feedback"} id={"decision-feedback"} role={"status"}></p>
              <button className={"lab-text-button"} type={"button"} id={"decision-to-timeline"} hidden>{"Pogledajte na vremenskoj crti "}<span aria-hidden={true} className={"arrow-up-right"} /></button>
            </details>
            <details className={"lab-disclosure studio-disclosure"}>
              <summary>{"Od bilješke do plana rada"}</summary>
              <p className={"studio-intro"}>{"Odaberite bilješku pa mjesto u planu, ili je povucite na željeno mjesto."}</p>
              <div className={"note-tray"} role={"group"} aria-label={"Bilješke za plan rada"}>
                <button type={"button"} draggable={true} data-note={"question"} aria-pressed={"false"}>{"Pitanje: kako nastaju odluke?"}</button>
                <button type={"button"} draggable={true} data-note={"source"} aria-pressed={"false"}>{"Izvor: razgovor i sudjelovanje"}</button>
                <button type={"button"} draggable={true} data-note={"reflection"} aria-pressed={"false"}>{"Rasprava: različiti pogledi"}</button>
              </div>
              <div className={"plan-zones"} aria-label={"Plan rada"}>
                <button type={"button"} data-zone={"uvod"}>
                  <span>{"01"}</span>
                  <b>{"Uvod"}</b>
                  <small>{"Odaberite bilješku"}</small>
                </button>
                <button type={"button"} data-zone={"izvori"}>
                  <span>{"02"}</span>
                  <b>{"Izvori"}</b>
                  <small>{"Odaberite bilješku"}</small>
                </button>
                <button type={"button"} data-zone={"rasprava"}>
                  <span>{"03"}</span>
                  <b>{"Rasprava"}</b>
                  <small>{"Odaberite bilješku"}</small>
                </button>
              </div>
              <p className={"lab-feedback"} id={"plan-feedback"} role={"status"}>{"Odaberite bilješku i zatim dio rada."}</p>
              <p className={"lab-caption"}>{"Ovo je ilustrativan plan koji posjetitelj sam slaže."}</p>
            </details>
            <details className={"lab-disclosure studio-disclosure"}>
              <summary>{"Što ako nestane veza?"}</summary>
              <p className={"studio-intro"}>{"Isprobajte kako bi izgledao prekid veze dok nastavljate pisati."}</p>
              <label className={"lab-label"} htmlFor={"offline-draft"}>{"Vaš nacrt"}</label>
              <textarea id={"offline-draft"} rows={3} maxLength={400} defaultValue={"Moja početna misao ostaje ovdje dok razvijam rad."}></textarea>
              <div className={"offline-row"}>
                <button className={"lab-action"} type={"button"} id={"offline-toggle"} aria-pressed={"false"}>{"Simuliraj prekid veze"}</button>
                <span id={"offline-state"} role={"status"}>{"Veza dostupna"}</span>
              </div>
              <p className={"lab-caption"}>{"Ovo je simulacija u ovoj stranici. Ne prekida stvarnu vezu i ne provjerava spremanje ili sinkronizaciju aplikacije."}</p>
            </details>
            <p className={"lab-caption"}>{"Sadržaj je ilustracija, ne preporuka metode. Konačne vodiče trebaju pregledati stručnjaci."}</p>
          </div>
        </div>
      </section>
      <section className={"atlas-panel"} role={"tabpanel"} id={"panel-izvori"} aria-labelledby={"tab-izvori"} tabIndex={0} hidden>
        <div className={"atlas-info"}>
          <p className={"index"}>{"02 / 07"}</p>
          <h3>{"Tvrdnja uz svoje izvore."}</h3>
          <p>{"Tvrdnju možete povezati s odabranim izvorima i vidjeti različite perspektive, uz bilješke i mjesto u izvoru."}</p>
          <ul>
            <li>
              <span>{"01"}</span>{" Mapa tvrdnji, izvora i pitanja"}
            </li>
            <li>
              <span>{"02"}</span>{" Citati, bibliografija i bilježnica izvora"}
            </li>
            <li>
              <span>{"03"}</span>{" Mjesto izvora uz odlomak rada"}
            </li>
            <li>
              <span>{"04"}</span>{" Različita gledišta koja označava student"}
            </li>
          </ul>
        </div>
        <div className={"vision-sheet lab-sheet"}>
          <div className={"vision-head"}>
            <strong>{"Mapa argumenta"}</strong>
            <span>{"Rad s izvorima"}</span>
          </div>
          <div className={"lab-main"}>
            <p className={"lab-kicker"}>{"Tvrdnja u radu"}</p>
            <div className={"argument-claim"}>{"Razgovor može pridonijeti razumijevanju odluka."}</div>
            <svg className={"argument-lines"} viewBox={"0 0 500 42"} preserveAspectRatio={"none"} aria-hidden={"true"}>
              <path d={"M250 0 V16 M82 42 V25 Q82 16 92 16 H408 Q418 16 418 25 V42 M250 16 V42"}></path>
            </svg>
            <div className={"source-buttons"} role={"group"} aria-label={"Odaberite izvor u primjeru"}>
              <button type={"button"} data-evidence={"a"} aria-pressed={"true"}>
                <b>{"A"}</b>
                <span>{"Potpora"}</span>
              </button>
              <button type={"button"} data-evidence={"b"} aria-pressed={"false"}>
                <b>{"B"}</b>
                <span>{"Drugi pogled"}</span>
              </button>
              <button type={"button"} data-evidence={"c"} aria-pressed={"false"}>
                <b>{"C"}</b>
                <span>{"Kontekst"}</span>
              </button>
            </div>
            <div className={"source-focus"} aria-live={"polite"}>
              <p className={"lab-kicker"} id={"source-title"}>{"Izvor A · stranica 12"}</p>
              <blockquote id={"source-quote"}>{"„Dijalog pomaže objasniti kako je odluka nastala.”"}</blockquote>
              <p id={"source-relation"}>{"Studentova oznaka: Potpora tvrdnji."}</p>
              <label className={"lab-label"} htmlFor={"source-role"}>{"Kako se izvor odnosi na tvrdnju?"}</label>
              <select id={"source-role"}>
                <option>{"Potpora tvrdnji"}</option>
                <option>{"Drugi pogled"}</option>
                <option>{"Kontekst"}</option>
              </select>
              <button className={"lab-text-button"} type={"button"} id={"source-to-qa"}>{"Pitajte ovaj izvor "}<span aria-hidden={true} className={"arrow-up-right"} /></button>
            </div>
            <details className={"lab-disclosure studio-disclosure"}>
              <summary>{"Jedna rečenica, cijela priča"}</summary>
              <p className={"studio-intro"}>{"Pratite kako se povezuju tekst, izvor i komentar."}</p>
              <div className={"story-steps"} role={"group"} aria-label={"Koraci priče o rečenici"}>
                <button type={"button"} data-story={"claim"} aria-pressed={"true"}>{"Rečenica"}</button>
                <button type={"button"} data-story={"source"} aria-pressed={"false"}>{"Izvor"}</button>
                <button type={"button"} data-story={"comment"} aria-pressed={"false"}>{"Komentar"}</button>
                <button type={"button"} data-story={"revision"} aria-pressed={"false"}>{"Dorada"}</button>
                <button type={"button"} data-story={"review"} aria-pressed={"false"}>{"Pregled"}</button>
              </div>
              <div className={"story-output"} aria-live={"polite"}>
                <p className={"lab-kicker"} id={"story-label"}>{"Rečenica u radu"}</p>
                <p id={"story-text"}>{"Razgovor može pridonijeti razumijevanju odluka."}</p>
              </div>
              <label className={"lab-label"} id={"story-revision-label"} htmlFor={"story-revision"} hidden>{"Vaša dorada tvrdnje"}</label>
              <textarea id={"story-revision"} rows={2} maxLength={300} hidden defaultValue={"Razgovor može pridonijeti razumijevanju odluka, iako ne uklanja sva neslaganja."}></textarea>
              <p className={"lab-caption"}>{"Veze su ilustrativne; primjer ne provjerava točnost tvrdnje."}</p>
            </details>
            <p className={"lab-caption"}>{"Prikaz koristi ogledne izvore. Odabrani odnos nije provjera točnosti tvrdnje."}</p>
          </div>
        </div>
      </section>
      <section className={"atlas-panel"} role={"tabpanel"} id={"panel-mentorstvo"} aria-labelledby={"tab-mentorstvo"} tabIndex={0} hidden>
        <div className={"atlas-info"}>
          <p className={"index"}>{"03 / 07"}</p>
          <h3>{"Povratna informacija uz tekst."}</h3>
          <p>{"Razumjeti povratnu informaciju znači vidjeti pitanje, promjenu i studentov odgovor u istome kontekstu."}</p>
          <ul>
            <li>
              <span>{"01"}</span>{" Komentari povezani s odlomkom"}
            </li>
            <li>
              <span>{"02"}</span>{" Usporedba odabranih verzija"}
            </li>
            <li>
              <span>{"03"}</span>{" Studentov odgovor i obrazloženje"}
            </li>
            <li>
              <span>{"04"}</span>{" Novi zadatak koji se nastavlja na rad"}
            </li>
          </ul>
        </div>
        <div className={"vision-sheet lab-sheet"}>
          <div className={"vision-head"}>
            <strong>{"Mentorski razgovor"}</strong>
            <span>{"Radni prostor"}</span>
          </div>
          <div className={"lab-main"}>
            <div className={"lab-comment"}>
              <b>{"Mentorova napomena"}</b>
              <p>{"Možete li objasniti zašto ste odabrali ovaj pristup?"}</p>
            </div>
            <div className={"lab-segment"} role={"group"} aria-label={"Usporedite odlomke"}>
              <button type={"button"} data-revision={"before"} aria-pressed={"true"}>{"Prije"}</button>
              <button type={"button"} data-revision={"after"} aria-pressed={"false"}>{"Poslije"}</button>
            </div>
            <div className={"revision-text"} id={"revision-text"} aria-live={"polite"}>{"„U istraživanju se koriste intervjui.”"}</div>
            <label className={"lab-label"} htmlFor={"mentor-reply"}>{"Studentov odgovor"}</label>
            <textarea id={"mentor-reply"} rows={2} maxLength={240} placeholder={"Odgovorite na komentar..."}></textarea>
            <button className={"lab-action"} type={"button"} id={"mentor-reply-show"}>{"Prikažite odgovor"}</button>
            <p className={"lab-feedback"} id={"mentor-reply-result"} role={"status"}></p>
            <details className={"lab-disclosure"}>
              <summary>{"Zadatak koji se nastavlja na rad"}</summary>
              <label className={"lab-label"} htmlFor={"followup-choice"}>{"Nastavnik odabire polazište"}</label>
              <select id={"followup-choice"}>
                <option value={"metoda"}>{"Odlomak o metodi"}</option>
                <option value={"argument"}>{"Komentar o argumentu"}</option>
              </select>
              <button className={"lab-action"} type={"button"} id={"followup-show"}>{"Prikažite zadatak"}</button>
              <p className={"lab-feedback"} id={"followup-output"} role={"status"}></p>
            </details>
            <p className={"lab-caption"}>{"Promjene ostaju u ovom pregledniku."}</p>
          </div>
        </div>
      </section>
      <section className={"atlas-panel"} role={"tabpanel"} id={"panel-proces"} aria-labelledby={"tab-proces"} tabIndex={0} hidden>
        <div className={"atlas-info"}>
          <p className={"index"}>{"04 / 07"}</p>
          <h3>{"Kako je rad nastajao"}</h3>
          <p>{"Reprodukcija daje uvid u promjene dokumenta. Student može dodati i vlastitu bilješku o odluci koju želi objasniti."}</p>
          <ul>
            <li>
              <span>{"01"}</span>{" Prikaz dokumenta tijekom pisanja"}
            </li>
            <li>
              <span>{"02"}</span>{" Reprodukcija i usporedba verzija"}
            </li>
            <li>
              <span>{"03"}</span>{" Studentove istraživačke odluke"}
            </li>
            <li>
              <span>{"04"}</span>{" Opis događaja bez zaključka o autorstvu"}
            </li>
          </ul>
        </div>
        <div className={"vision-sheet lab-sheet"}>
          <div className={"vision-head"}>
            <strong>{"Vremenska crta rada"}</strong>
            <span>{"Pregled promjena"}</span>
          </div>
          <div className={"lab-main"}>
            <p className={"replay-story"} id={"vision-replay-text"}>{"Svaka ideja počinje pitanjem."}</p>
            <p className={"replay-events"} id={"vision-replay-caption"}>{"Prva rečenica"}</p>
            <div className={"replay-controls"}>
              <button type={"button"} id={"vision-replay-play"}>{"Pokreni"}</button>
              <label htmlFor={"vision-replay-range"} className={"visually-hidden"}>{"Korak reprodukcije"}</label>
              <input type={"range"} id={"vision-replay-range"} min={"0"} max={"4"} step={"1"} defaultValue={"0"} aria-valuetext={"Prva rečenica"} />
            </div>
            <div className={"decision-echo"}>
              <p className={"lab-kicker"}>{"Studentova odluka"}</p>
              <p id={"decision-timeline"} aria-live={"polite"}>{"U kartici Pisanje možete odabrati pristup i dodati vlastitu bilješku."}</p>
            </div>
            <details className={"lab-disclosure studio-disclosure"}>
              <summary>{"Reprodukcija vašeg teksta"}</summary>
              <p className={"studio-intro"}>{"Promjene teksta s početka stranice, uključujući obrisani tekst. Čuva se do 120 posljednjih promjena dok je stranica otvorena."}</p>
              <label className={"lab-label"} htmlFor={"own-history-range"}>{"Korak reprodukcije "}
                <span id={"own-history-index"}>{"1 / 1"}</span>
              </label>
              <input className={"history-range"} type={"range"} min={"0"} max={"0"} defaultValue={"0"} step={"1"} id={"own-history-range"} aria-valuetext={"Korak 1 od 1"} />
              <div className={"history-page"} id={"own-history-text"} aria-live={"polite"}></div>
              <a className={"history-link"} href={"#primjer"}>{"Promijenite tekst na početku stranice "}<span aria-hidden={true} className={"arrow-up-right"} /></a>
              <p className={"lab-caption"}>{"Ova simulacija postoji samo dok je stranica otvorena. Stvarni prikaz i reprodukcija čekaju pravno mišljenje i procjenu učinka prije pilota sa studentima."}</p>
            </details>
            <p className={"lab-caption"}>{"Bilješku unosi student. Prikaz uživo i reprodukcija uključuju i kasnije obrisan tekst te prije stvarnog pilota čekaju pravno mišljenje i procjenu učinka."}</p>
          </div>
        </div>
      </section>
      <section className={"atlas-panel"} role={"tabpanel"} id={"panel-predaja"} aria-labelledby={"tab-predaja"} tabIndex={0} hidden>
        <div className={"atlas-info"}>
          <p className={"index"}>{"05 / 07"}</p>
          <h3>{"Priprema za završni razgovor."}</h3>
          <p>{"Od pregleda rada i predaje do pitanja koja studentu pomažu pripremiti se za obranu."}</p>
          <ul>
            <li>
              <span>{"01"}</span>{" Pregled verzije i izjava"}
            </li>
            <li>
              <span>{"02"}</span>{" Potvrda i izvoz rada"}
            </li>
            <li>
              <span>{"03"}</span>{" Pitanja povezana s vlastitim radom"}
            </li>
            <li>
              <span>{"04"}</span>{" Prostor za pripremu odgovora"}
            </li>
          </ul>
        </div>
        <div className={"vision-sheet lab-sheet"}>
          <div className={"vision-head"}>
            <strong>{"Vježba obrane"}</strong>
            <span>{"Priprema za obranu"}</span>
          </div>
          <div className={"lab-main"}>
            <p className={"lab-kicker"}>{"Pitanje za razmišljanje"}</p>
            <div className={"defense-question"} id={"defense-question"}>{"Zašto ste odabrali upravo ovu metodu istraživanja?"}</div>
            <button className={"lab-text-button"} type={"button"} id={"defense-next"}>{"Prikažite drugo pitanje "}<span aria-hidden={true} className={"arrow-up-right"} /></button>
            <label className={"lab-label"} htmlFor={"defense-answer"}>{"Kako biste odgovorili?"}</label>
            <textarea id={"defense-answer"} rows={3} maxLength={400} placeholder={"Ovdje možete pripremiti odgovor..."}></textarea>
            <button className={"lab-action"} type={"button"} id={"defense-save"}>{"Zabilježite odgovor"}</button>
            <p className={"lab-feedback"} id={"defense-output"} role={"status"}></p>
            <details className={"lab-disclosure studio-disclosure"}>
              <summary>{"Pregled prije predaje"}</summary>
              <p className={"studio-intro"}>{"Dopunite rad i pogledajte pregled osnovnih stavki."}</p>
              <label className={"lab-label"} htmlFor={"preflight-title"}>{"Naslov rada"}</label>
              <input className={"studio-input"} id={"preflight-title"} type={"text"} maxLength={100} placeholder={"Unesite naslov rada"} />
              <label className={"lab-label"} htmlFor={"preflight-body"}>{"Kratki tekst rada"}</label>
              <textarea id={"preflight-body"} rows={2} maxLength={300} placeholder={"Unesite nekoliko riječi..."}></textarea>
              <label className={"studio-check"}>
                <input type={"checkbox"} id={"preflight-source"} />{" Naveden je izvor"}
              </label>
              <ul className={"preflight-list"} aria-live={"polite"}>
                <li id={"preflight-title-state"}>{"○ Naslov nije unesen"}</li>
                <li id={"preflight-body-state"}>{"○ Tekst nije unesen"}</li>
                <li id={"preflight-source-state"}>{"○ Izvor nije označen"}</li>
              </ul>
              <p className={"lab-caption"}>{"Provjerava se ispunjenost triju stavki, ne kvaliteta rada."}</p>
            </details>
            <div className={"defense-foot"}>
              <span>{"01 Pregled rada"}</span>
              <span>{"02 Izjava"}</span>
              <span>{"03 Potvrda"}</span>
            </div>
            <p className={"lab-caption"}>{"Pripremljena pitanja ne ocjenjuju i ne šalju vaš odgovor."}</p>
          </div>
        </div>
      </section>
      <section className={"atlas-panel"} role={"tabpanel"} id={"panel-asistent"} aria-labelledby={"tab-asistent"} tabIndex={0} hidden>
        <div className={"atlas-info"}>
          <p className={"index"}>{"06 / 07"}</p>
          <h3>{"Pitajte svoje izvore."}</h3>
          <p>{"Zamislite pomoćnika koji se oslanja na materijale koje je student odabrao i pokazuje mjesto koje treba provjeriti."}</p>
          <ul>
            <li>
              <span>{"01"}</span>{" Student odabire izvor i pitanje"}
            </li>
            <li>
              <span>{"02"}</span>{" Poveznica na odlomak u izvoru"}
            </li>
            <li>
              <span>{"03"}</span>{" Uporaba prema pravilima zadatka"}
            </li>
            <li>
              <span>{"04"}</span>{" Pregled prije preuzimanja teksta"}
            </li>
          </ul>
          <p className={"replay-note"} style={{"color": "#e4c0a9", "marginTop": "18px"}}>{"Ugrađeni AI pomoćnik planiran je nakon prvog pilota."}</p>
        </div>
        <div className={"vision-sheet lab-sheet"}>
          <div className={"vision-head"}>
            <strong>{"Razgovor s izvorom"}</strong>
            <span>{"Pregled mogućnosti"}</span>
          </div>
          <div className={"lab-main"}>
            <label className={"lab-label"} htmlFor={"qa-source"}>{"Odabrani izvor"}</label>
            <select id={"qa-source"}>
              <option value={"a"}>{"Izvor A · str. 12"}</option>
              <option value={"b"}>{"Izvor B · str. 8"}</option>
              <option value={"c"}>{"Izvor C · str. 3"}</option>
            </select>
            <p className={"lab-kicker qa-question-label"}>{"Pitanje"}</p>
            <p className={"qa-question"}>{"Što ovaj izvor kaže o razgovoru?"}</p>
            <button className={"lab-action"} type={"button"} id={"qa-show"}>{"Prikažite odgovor"}</button>
            <div id={"qa-answer"} className={"qa-answer"} hidden>
              <p id={"qa-answer-text"}></p>
              <button className={"lab-text-button"} type={"button"} id={"qa-open"} aria-expanded={"false"} aria-controls={"qa-quote"}>{"Pogledajte odlomak izvora "}<span aria-hidden={true} className={"arrow-up-right"} /></button>
              <blockquote id={"qa-quote"} hidden></blockquote>
            </div>
            <p className={"lab-caption"}>{"Odgovori su unaprijed pripremljeni; ovaj prikaz ne koristi AI niti šalje tekst."}</p>
          </div>
        </div>
      </section>
      <section className={"atlas-panel"} role={"tabpanel"} id={"panel-ustanova"} aria-labelledby={"tab-ustanova"} tabIndex={0} hidden>
        <div className={"atlas-info"}>
          <p className={"index"}>{"07 / 07"}</p>
          <h3>{"Upute za različite ustanove."}</h3>
          <p>{"Za ustanove diljem Hrvatske, uz pravila i vodiče prilagođene potvrđenom profilu pojedine ustanove."}</p>
          <ul>
            <li>
              <span>{"01"}</span>{" Pravila ustanove i kolegija"}
            </li>
            <li>
              <span>{"02"}</span>{" Fakultetski vodiči i nastavni materijali"}
            </li>
            <li>
              <span>{"03"}</span>{" Uloge i pristup prema odnosu"}
            </li>
            <li>
              <span>{"04"}</span>{" Upravljanje podacima i izvoz"}
            </li>
          </ul>
        </div>
        <div className={"vision-sheet lab-sheet"}>
          <div className={"vision-head"}>
            <strong>{"Pravila ustanove"}</strong>
            <span>{"Ilustrativni profili"}</span>
          </div>
          <div className={"lab-main"}>
            <p className={"lab-kicker"}>{"Kako bi profil mogao izgledati"}</p>
            <div className={"lab-segment"} role={"group"} aria-label={"Odabir zamišljenog profila"}>
              <button type={"button"} data-policy={"author"} aria-pressed={"true"}>{"Autor i godina"}</button>
              <button type={"button"} data-policy={"number"} aria-pressed={"false"}>{"Brojčano"}</button>
            </div>
            <div className={"policy-preview"} aria-live={"polite"}>
              <p className={"lab-kicker"}>{"Primjer navođenja"}</p>
              <p id={"policy-citation"}>{"(Autor, godina)"}</p>
              <span id={"policy-desc"}>{"Sustav autor–godina, uz smjernice dodijeljene zadatku."}</span>
            </div>
            <div className={"policy-guide"}>
              <p className={"lab-kicker"}>{"Vodič uz zadatak"}</p>
              <p>{"Objašnjenje, primjer i poveznica na pravilo koje je ustanova potvrdila."}</p>
            </div>
            <p className={"lab-caption"}>{"Prikazani stilovi nisu službena pravila. Podrška ovisi o potvrđenom profilu i dogovoru s ustanovom."}</p>
            <details className={"lab-disclosure studio-disclosure"}>
              <summary>{"Istražite svoju ustanovu"}</summary>
              <p className={"studio-intro"}>{"Odaberite ustanovu iz Lektina kataloga i vrstu rada. Nazivi su stvarni; zadatak je ilustracija."}</p>
              <label className={"lab-label"} htmlFor={"faculty-search"}>{"Pronađite fakultet ili ustanovu"}</label>
              <input className={"studio-input"} id={"faculty-search"} type={"search"} autoComplete={"off"} placeholder={"Na primjer: Split, ekonomija, Rijeka…"} />
              <p className={"faculty-search-count"} id={"faculty-search-count"} role={"status"}></p>
              <label className={"lab-label"} htmlFor={"faculty-unit"}>{"Ustanova ili sastavnica"}</label>
              <select id={"faculty-unit"}>
                <option value={""}>{"Odaberite ustanovu"}</option>
              </select>
              <label className={"lab-label"} htmlFor={"faculty-program"}>{"Program iz kataloga Lekte"}</label>
              <select id={"faculty-program"} disabled>
                <option>{"Najprije odaberite ustanovu"}</option>
              </select>
              <label className={"lab-label"} htmlFor={"faculty-work"}>{"Vrsta rada"}</label>
              <select id={"faculty-work"}>
                <option value={"seminarski"}>{"Seminarski rad"}</option>
                <option value={"esej"}>{"Esej"}</option>
                <option value={"zavrsni"}>{"Završni rad"}</option>
                <option value={"diplomski"}>{"Diplomski rad"}</option>
              </select>
              <label className={"lab-label"} htmlFor={"faculty-focus"}>{"Odabir pristupa"}</label>
              <select id={"faculty-focus"}>
                <option value={"analiza"}>{"Analiza"}</option>
                <option value={"slucaj"}>{"Studija slučaja"}</option>
                <option value={"pregled"}>{"Pregled literature"}</option>
              </select>
              <label className={"lab-label"} htmlFor={"faculty-length"}>{"Opseg rada"}</label>
              <select id={"faculty-length"}>
                <option value={"800–1.200 riječi"}>{"800–1.200 riječi"}</option>
                <option value={"1.500–2.500 riječi"}>{"1.500–2.500 riječi"}</option>
                <option value={"3.000–4.500 riječi"}>{"3.000–4.500 riječi"}</option>
              </select>
              <div className={"faculty-scenario"} aria-live={"polite"}>
                <p className={"lab-kicker"}>{"Studentski pogled · ogledni zadatak"}</p>
                <h4 id={"faculty-example-title"}>{"Odaberite ustanovu"}</h4>
                <p id={"faculty-example-desc"}>{"Odaberite ustanovu i oblik rada."}</p>
                <p id={"faculty-example-program"}></p>
                <p id={"faculty-example-limits"}></p>
              </div>
              <div className={"faculty-citations"} id={"faculty-citations"} aria-live={"polite"}>
                <b>{"Lektini zapisi o citiranju"}</b>
                <p>{"Odaberite ustanovu za pregled dostupnih zapisa."}</p>
              </div>
              <p className={"lab-caption"}>{"Podaci o ustanovama i citiranju temelje se na javnoj snimci Lekte od 28. 10. 2026. Prikaz zadatka je ogledan; provjerite aktualna pravila za konkretan rad. "}
                <a className={"faculty-source"} href={"https://github.com/danielrisavi77-create/Lekta/blob/master/data/tools/citation-specs/verified-index.json"} target={"_blank"} rel={"noopener noreferrer"}>{"Pregledajte javni indeks Lekte "}<span aria-hidden={true} className={"arrow-up-right"} /></a>
                <span className={"facility-note"}>{"Indeks navodi naziv izvora i datum provjere; nije poveznica na sam pravilnik ustanove."}</span>
              </p>
            </details>
            <details className={"lab-disclosure studio-disclosure"}>
              <summary>{"Tko vidi što?"}</summary>
              <p className={"studio-intro"}>{"Odaberite ulogu u zamišljenom radu."}</p>
              <div className={"role-selector"} role={"group"} aria-label={"Uloge u primjeru"}>
                <button type={"button"} data-role={"student"} aria-pressed={"true"}>{"Student"}</button>
                <button type={"button"} data-role={"teacher"} aria-pressed={"false"}>{"Nastavnik / mentor"}</button>
                <button type={"button"} data-role={"admin"} aria-pressed={"false"}>{"Administrator"}</button>
              </div>
              <div className={"role-output"} aria-live={"polite"}>
                <p className={"lab-kicker"} id={"role-label"}>{"Student"}</p>
                <p id={"role-detail"}>{"Vidi svoj rad i isti predviđeni prikaz nastanka rada koji je dostupan dodijeljenom nastavniku ili mentoru."}</p>
              </div>
              <p className={"lab-caption"}>{"Planirani prikaz uživo i reprodukcija mogu uključivati poslije obrisan tekst. Stvarni pilot čeka pravno mišljenje i procjenu učinka."}</p>
            </details>
          </div>
        </div>
      </section>
    </div>
  </section>
  <section className={"student"} id={"studenti"}>
    <div className={"student-grid"}>
      <div className={"student-copy"}>
        <p className={"smallcaps"}>{"Za studente"}</p>
        <h2>{"Upute i izvori"}
          <br />
          <em>{"uz vaš tekst."}</em>
        </h2>
        <p>{"Bilješke, citati i komentari vezani su uz rad na kojem radite. Lakše je vratiti se na pitanje, pronaći izvor ili odgovoriti mentoru."}</p>
        <p>{"Citiranje i bibliografija prema pravilima ustanove dio su planirane cjeline."}</p>
        <a href={"#mogucnosti"} id={"explore-writing"}>{"Istražite prostor za pisanje "}<span aria-hidden={true} className={"arrow-right"} /></a>
      </div>
      <div className={"student-visual"}>
        <div className={"workspace-preview"}>
          <div className={"workspace-top"}>
            <b>{"Radni prostor"}</b>
            <span>{"Prikaz mogućnosti"}</span>
          </div>
          <div className={"workspace-main"}>
            <p className={"smallcaps"}>{"Sve uz vaš tekst"}</p>
            <h3>{"Od prve bilješke"}
              <br />{"do predaje."}
            </h3>
            <div className={"workspace-row"}>
              <strong>{"Struktura"}</strong>
              <p>{"Pitanje, poglavlja i bilješke na jednom mjestu."}</p>
            </div>
            <div className={"workspace-row"}>
              <strong>{"Izvori"}</strong>
              <p>{"Citati i literatura povezani s radom."}</p>
            </div>
            <div className={"workspace-row"}>
              <strong>{"Mentorstvo"}</strong>
              <p>{"Komentar uz odlomak i prostor za doradu."}</p>
            </div>
            <div className={"workspace-row"}>
              <strong>{"Upute"}</strong>
              <p>{"Pravila ustanove uz odgovarajući zadatak."}</p>
            </div>
            <p className={"workspace-note"}>{"Prikaz je dio vizije; dostupnost pojedinih mogućnosti ovisi o fazi razvoja i profilu ustanove."}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section className={"faculty"} id={"fakulteti"}>
    <div className={"wrap"}>
      <div className={"faculty-head"}>
        <p className={"smallcaps"}>{"Za fakultete diljem Hrvatske"}</p>
        <div>
          <h2>{"Jasan zadatak."}
            <br />
            <em>{"Razgovor uz rad."}</em>
          </h2>
          <p className={"faculty-intro"}>{"Zajednički prostor za zadatke, studentske radove i povratne informacije, uz pravila pojedine ustanove. Odluke o radu donosi nastavnik i fakultet."}</p>
        </div>
      </div>
      <div className={"faculty-list"}>
        <div className={"faculty-row"}>
          <span className={"num"}>{"01"}</span>
          <h3>{"Upute uz zadatak"}</h3>
          <p>{"Student prije pisanja vidi upute, rokove i obavijest o tome što se bilježi i tko vidi rad."}</p>
        </div>
        <div className={"faculty-row"}>
          <span className={"num"}>{"02"}</span>
          <h3>{"Komentari uz tekst"}</h3>
          <p>{"Nastavnik komentira odlomak, a student na istome mjestu odgovara i nastavlja doradu."}</p>
        </div>
        <div className={"faculty-row"}>
          <span className={"num"}>{"03"}</span>
          <h3>{"Pregled prije predaje"}</h3>
          <p>{"Verzije rada i planirani pregled nastanka pomažu pripremiti razgovor. Konačnu procjenu donosi čovjek."}</p>
        </div>
      </div>
      <div className={"faculty-action"}>
        <a href={"#kontakt"}>{"Razgovarajmo o Ducturi "}<span aria-hidden={true} className={"arrow-right"} /></a>
        <button className={"faculty-secondary"} type={"button"} id={"faculty-explore"}>{"Istražite svoju ustanovu"}</button>
        <button className={"faculty-secondary"} type={"button"} id={"open-faculty"}>{"Kako izgleda suradnja?"}</button>
      </div>
      <div className={"faculty-path"}>
        <h3>{"Od razgovora"}
          <br />{"do uvođenja."}
        </h3>
        <div>
          <ol>
            <li>
              <span>{"01"}</span>
              <div>
                <b>{"Upoznajemo potrebe"}</b>
                <p>{"Vrste radova, iskustvo studenata i način suradnje s nastavnicima."}</p>
              </div>
            </li>
            <li>
              <span>{"02"}</span>
              <div>
                <b>{"Provjeravamo okvir"}</b>
                <p>{"Pravila ustanove, pristup korisnika, tehničke i pravne uvjete."}</p>
              </div>
            </li>
            <li>
              <span>{"03"}</span>
              <div>
                <b>{"Dogovaramo sljedeći korak"}</b>
                <p>{"Predstavljanje dostupnog proizvoda, mogući pilot i komercijalni model prema dogovoru."}</p>
              </div>
            </li>
          </ol>
          <p className={"path-note"}>{"Pilot sa stvarnim studentima zahtijeva dogovor i ispunjavanje potrebnih uvjeta."}</p>
        </div>
      </div>
    </div>
  </section>
  <section className={"principle"} id={"povjerenje"}>
    <div className={"wrap principle-grid"}>
      <div>
        <p className={"smallcaps"}>{"Vidljivost i pristup"}</p>
        <h2>{"Jasno tko"}
          <br />
          <em>{"vidi što."}</em>
        </h2>
        <p className={"principle-lead"}>{"Prije pisanja student treba znati tko ima pristup radu i što je u prikazu nastanka vidljivo."}</p>
      </div>
      <div className={"principle-facts"}>
        <div className={"fact"}>
          <h3>{"Tko vidi rad?"}</h3>
          <p>{"Student i nastavnik zadatka odnosno dodijeljeni mentor. Sama uloga ne daje automatski pristup tuđim radovima."}</p>
        </div>
        <div className={"fact"}>
          <h3>{"Što je vidljivo?"}</h3>
          <p>{"Planirani prikaz uživo i reprodukcija uključuju i tekst koji student poslije obriše. Student i dodijeljeni nastavnik ili mentor vide isti prikaz."}</p>
        </div>
        <div className={"fact"}>
          <h3>{"Što Ductura zaključuje?"}</h3>
          <p>{"Ne donosi zaključak o autorstvu ni o dopuštenosti uporabe umjetne inteligencije. Zapis podupire razgovor; odluku donosi čovjek."}</p>
        </div>
      </div>
    </div>
    <div className={"wrap trust-more"}>
      <article>
        <h3>{"Pristup i objašnjenje"}</h3>
        <p>{"Prema pravilima proizvoda, student treba moći vidjeti tko je otvorio njegov rad te dodati napomenu ili osporiti opis događaja."}</p>
      </article>
      <article>
        <h3>{"Čuvanje i uvjeti"}</h3>
        <p>{"Rokovi čuvanja i ugovorne uloge uređuju se s ustanovom. Prikaz uživo i reprodukcija čekaju pravno mišljenje i procjenu učinka prije pilota sa stvarnim studentima."}</p>
      </article>
    </div>
  </section>
  <section className={"catalogue"} id={"sve-mogucnosti"} aria-labelledby={"catalogue-title"}>
    <div className={"wrap"}>
      <div className={"catalogue-head"}>
        <p className={"smallcaps"}>{"Cjelovita vizija"}</p>
        <div>
          <h2 id={"catalogue-title"}>{"Pregled svih "}
            <em>{"mogućnosti."}</em>
          </h2>
          <p>{"Odaberite cjelinu za detaljan pregled planiranih mogućnosti za studente, nastavnike, mentore i fakultete."}</p>
          <p className={"catalogue-note"}>{"Prikazana je cjelovita zamisao proizvoda. Dio funkcija je u razvoju ili planiran, a neke ovise o dodatnim odlukama i dogovoru s ustanovom."}</p>
        </div>
      </div>
      <div className={"catalogue-list"}>
        <details>
          <summary>
            <span className={"number"}>{"01"}</span>{" "}
            <strong>{"Početak i organizacija rada"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Prijava AAI@EduHr"}</strong>{" za korisnike ustanove."}
              </li>
              <li>{"Kolegiji, upis kodom, zadaci i mentorirani radovi."}</li>
              <li>{"Podnesci, eseji, seminarski, završni, diplomski i drugi akademski radovi."}</li>
              <li>{"Popis radova, rokova, otvorenih komentara i trenutačnog koraka."}</li>
              <li>{"Obavijest prije pisanja: upute, prava pristupa i ono što se bilježi."}</li>
              <li>{"Upute, traženi opseg i pravila pomoći za pojedini zadatak."}</li>
              <li>{"Vodič za razmišljanje o različitim istraživačkim metodama."}</li>
            </ul>
            <ul>
              <li>{"Uvodni vodič i hrvatsko te englesko sučelje."}</li>
              <li>{"Jezik rada odvojen od jezika sučelja."}</li>
              <li>{"Podsjetnici o rokovima i obavijesti u aplikaciji ili e-poštom."}</li>
              <li>{"Plan rada, osobni ciljevi po poglavljima i pregled napretka."}</li>
              <li>{"Bilješke uz rad dostupne i s mobitela, u kasnijoj fazi."}</li>
              <li>{"Primjer slaganja bilježaka u početni plan rada."}</li>
            </ul>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"02"}</span>{" "}
            <strong>{"Akademski uređivač"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Struktura:"}</strong>{" numerirani naslovi, sadržaj i naslovna stranica."}
              </li>
              <li>{"Predlošci rada i profili oblika prema pravilima ustanove."}</li>
              <li>{"Oblikovanje teksta, popisi, citatni blokovi i hrvatski navodnici."}</li>
              <li>{"Fusnote, tablice, slike i opisi prikaza."}</li>
              <li>{"Popisi tablica i slika te poveznice na prikaze u tekstu."}</li>
              <li>{"Traženje i zamjena, prečaci i način za fokus."}</li>
              <li>{"Brzi navodi, oznake za dopunu i pomoć pri oblikovanju strukture teksta."}</li>
              <li>{"Studentova vlastita bilješka o istraživačkoj odluci."}</li>
            </ul>
            <ul>
              <li>{"Opseg rada, broj riječi i osobni cilj po poglavlju."}</li>
              <li>{"Provjera oblika i opsega prema profilu fakulteta."}</li>
              <li>{"Pravopis prema jeziku rada."}</li>
              <li>{"Vidljivo stanje spremanja, rad bez mreže i naknadna sinkronizacija."}</li>
              <li>{"Oporavak nacrta i jasan prikaz stanja dokumenta."}</li>
              <li>{"Uvoz DOCX-a i PDF-a te izvoz rada u planiranim formatima."}</li>
            </ul>
            <p className={"context"}>{"Pravila oblika planiraju se preuzimati iz paketa povezanog s Lektom; njihova uporaba ovisi o potrebnoj licenci i potvrđenom profilu ustanove."}</p>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"03"}</span>{" "}
            <strong>{"Izvori, citiranje i literatura"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Bilježnica izvora"}</strong>{" uz pojedini rad s bilješkama iz čitanja."}
              </li>
              <li>{"Bibliografski podaci, DOI i ISBN."}</li>
              <li>{"Umetanje navoda sa stranicom i bibliografija u stilu fakulteta."}</li>
              <li>{"Usklađivanje citata i pripadajućeg popisa literature."}</li>
              <li>{"Podrška za više navoda i razlikovanje istog autora i godine."}</li>
            </ul>
            <ul>
              <li>{"Uvoz izvora iz Zotera te formata BibTeX, RIS i CSL-JSON."}</li>
              <li>{"PDF izvori s isticanjem, bilješkama i oznakom stranice."}</li>
              <li>{"Provjera doslovnog navoda prema učitanom PDF izvoru."}</li>
              <li>{"Provjera postojanja DOI-ja i URL-a."}</li>
              <li>{"Mjesta na kojima student želi naknadno dopuniti izvor."}</li>
              <li>{"Mapa tvrdnji i izvora: student označava potporu, drugi pogled ili kontekst uz citat i stranicu."}</li>
              <li>{"Prikaz veze između odlomka, izvora, komentara i dorade."}</li>
            </ul>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"04"}</span>{" "}
            <strong>{"Mentorstvo i suradnja"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Komentari uz odlomak"}</strong>{", odgovori i razgovori."}
              </li>
              <li>{"Prijedlozi izmjena koje student prihvaća ili odbija."}</li>
              <li>{"Izravne izmjene nastavnika uz dogovor i jasno pripisivanje."}</li>
              <li>{"Zahtjev za doradu, stanje zahtjeva i nova verzija rada."}</li>
              <li>{"Odabrani odlomak prije i poslije dorade, uz komentar i studentov odgovor."}</li>
              <li>{"Nastavnik može odabrati odlomak ili komentar kao polazište za idući zadatak."}</li>
              <li>{"Odgođena zajednička objava komentara i banka komentara."}</li>
            </ul>
            <ul>
              <li>{"Promjene od nastavnikova zadnjeg pregleda."}</li>
              <li>{"Konzultacije povezane s verzijom i zajedničkim dogovorima."}</li>
              <li>{"Ključne etape mentorskog rada i pojedinačno produljenje roka."}</li>
              <li>{"Mentorski pregled na računalu i komentari na mobitelu."}</li>
              <li>{"Privatni mentorovi radni zapisi odvojeni su od zajedničkog prikaza rada."}</li>
            </ul>
            <p className={"context"}>{"Konzultacije i pojedini mentorovi radni zapisi ovise o pravnom mišljenju i daljnjoj razradi."}</p>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"05"}</span>{" "}
            <strong>{"Verzije i nastanak rada"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Nacrti i verzije"}</strong>{" kroz cijeli tijek rada."}
              </li>
              <li>{"Slanje verzije na pregled, usporedba i pregled promjena."}</li>
              <li>{"Vremenska crta i opis događaja: pisanje, uvoz, lijepljenje i komentari."}</li>
              <li>{"Planirani prikaz uživo i reprodukcija nastanka dokumenta."}</li>
              <li>{"U interaktivnom primjeru moguće je pratiti promjene vlastitog demo teksta."}</li>
              <li>{"Student i nastavnik zadatka odnosno mentor vide isti prikaz procesa."}</li>
            </ul>
            <ul>
              <li>{"Studentova napomena, objašnjenje i osporavanje opisa događaja."}</li>
              <li>{"Dobrovoljne bilješke o istraživačkim odlukama povezane s etapama rada."}</li>
              <li>{"Oznake opaženog, uvezenog i onoga što je student naveo."}</li>
              <li>{"Studentova vlastita povijest i alternativni odlomci, uz predviđene uvjete."}</li>
              <li>{"Pregled vlastitog napretka bez uspoređivanja studenata."}</li>
              <li>{"Prikaz praznina u zapisu kao praznina, uz objašnjenje."}</li>
            </ul>
            <p className={"context"}>
              <b>{"Transparentnost:"}</b>{" predviđeni pogled uživo i reprodukcija uključuju tekst koji se poslije može obrisati. Prije pilota sa stvarnim studentima čekaju pravno mišljenje i procjenu učinka. Ductura na temelju zapisa ne procjenjuje autorstvo."}
            </p>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number catalogue-number-six"} aria-hidden={true}></span>{" "}
            <strong>{"AI pomoćnik za studenta"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Dobrovoljna uporaba"}</strong>{" kad je pomoć dopuštena pravilima zadatka."}
              </li>
              <li>{"Objašnjenje pojma i mentorova komentara, lektura, prijevod i pomoć pri traženju literature."}</li>
              <li>{"Pitanja o odabranom izvoru, uz odlomak i stranicu koje student može provjeriti."}</li>
              <li>{"Formatiranje i transkripcija kad su dopušteni pravilima zadatka."}</li>
              <li>{"Razrada ideje kroz pitanja, strukturiranje, primjeri i kodiranje podataka kad su dopušteni."}</li>
              <li>{"Odabir svrhe uporabe i modela među dopuštenima."}</li>
              <li>{"Pregled predloženih izmjena prije nego što ih student primijeni."}</li>
            </ul>
            <ul>
              <li>{"Poseban pregled promijenjenih brojki, citata i oznaka izvora."}</li>
              <li>{"Student odlučuje kada šalje tekst odabranom pružatelju."}</li>
              <li>{"Vidljivi podaci o pružatelju, modelu, svrsi i prenesenom tekstu."}</li>
              <li>{"Razgovori i vanjski alati prilažu se izjavi prema pravilima zadatka."}</li>
              <li>{"Ductura ne donosi ocjenu o studentu na temelju AI analize procesa."}</li>
            </ul>
            <p className={"context"}>
              <b>{"Kasnija faza:"}</b>{" ugrađeni pomoćnik je izvan prvog pilota. Izbor pružatelja i način prijave za pomoćnika ovise o zasebnim odlukama."}
            </p>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"07"}</span>{" "}
            <strong>{"Predaja i zaštita studenta"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Pregled prije predaje"}</strong>{" s tekstom rada i pravilima zadatka."}
              </li>
              <li>{"Izjava o korištenoj pomoći i vanjskim alatima, prema pravilima ustanove."}</li>
              <li>{"Napomena studenta i pregled priloga izjavi."}</li>
              <li>{"Konačna verzija, vrijeme predaje i potvrda."}</li>
              <li>{"Provjera može li se predani rad rekonstruirati iz zapisa."}</li>
            </ul>
            <ul>
              <li>{"Izvoz rada i potvrde u planiranim formatima."}</li>
              <li>{"Prenosivi zapis, potvrda i planirani QR/verifikator."}</li>
              <li>{"Paket rada za studenta i, kad je primjenjivo, referadu."}</li>
              <li>{"Opisni paket za ovlaštene postupke, uz pravila pristupa."}</li>
              <li>{"Pravo studenta da doda objašnjenje ili ospori opis događaja."}</li>
            </ul>
            <p className={"context"}>{"Potvrda i provjera odnose se na cjelovitost zapisa; same po sebi ne utvrđuju tko je autor rada."}</p>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"08"}</span>{" "}
            <strong>{"Mentorski radovi i obrana"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Završni, diplomski i drugi mentorski radovi"}</strong>{" u strukturiranim etapama."}
              </li>
              <li>{"Dodjela mentora i planirani komentor."}</li>
              <li>{"Rokovi, verzije i zapisi dogovora na konzultacijama."}</li>
              <li>{"Studentova priprema za razgovor i obranu."}</li>
              <li>{"Vježba s pitanjima o radu i prostorom za vlastite odgovore, bez automatskog ocjenjivanja."}</li>
            </ul>
            <ul>
              <li>{"Materijali povezani s predanom verzijom rada."}</li>
              <li>{"Priprema pitanja i relevantnih dijelova rada za razgovor."}</li>
              <li>{"Pristup člana povjerenstva samo dodijeljenom radu i na određeno vrijeme."}</li>
              <li>{"Portfelj rada nakon studija kao planirano proširenje."}</li>
            </ul>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"09"}</span>{" "}
            <strong>{"Prostor za fakultet"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Ustanove, akademske godine, kolegiji i zadaci."}</strong>
              </li>
              <li>{"Uloge nastavnika, mentora, studenata i administratora."}</li>
              <li>{"Pravila ustanove, kolegija i zadatka te njihove verzije."}</li>
              <li>{"Vodiči i primjeri povezani s potvrđenim pravilima pojedine ustanove."}</li>
              <li>{"Pregled ustanova i postojećih zapisa o citiranju iz javnih podataka Lekte, uz provjeru opsega i aktualnosti."}</li>
              <li>{"Dopuštene vrste pomoći, AI pružatelji i pravila uvoza."}</li>
              <li>{"Pregled tijeka zadataka i radova uz primjenjive ovlasti."}</li>
              <li>{"Zbirni pregled kolegija bez imena, uz najmanji predviđeni broj sudionika."}</li>
            </ul>
            <ul>
              <li>{"Obavijesti, rokovi i mogućnost produljenja za studenta."}</li>
              <li>{"Pravila čuvanja, institucionalni izvoz i izlaz iz usluge."}</li>
              <li>{"Pregled pristupa i administrativnih promjena."}</li>
              <li>{"Planirani status sustava, postupak incidenta i provjera oporavka."}</li>
              <li>{"Cilj pristupačnosti WCAG 2.1 AA, uz planirani vanjski pregled i dokumentaciju."}</li>
            </ul>
            <p className={"context"}>{"Administrator nema automatski pristup sadržaju studentskih radova samo na temelju svoje uloge."}</p>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"10"}</span>{" "}
            <strong>{"Privatnost i granice proizvoda"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Prije početka:"}</strong>{" jasna obavijest o pravilima i vidljivosti rada."}
              </li>
              <li>{"Pristup je vezan uz ulogu i stvarni odnos prema kolegiju ili radu."}</li>
              <li>{"Student ima pregled predviđenog pristupa svojem radu."}</li>
              <li>{"Različiti rokovi čuvanja za različite vrste podataka."}</li>
              <li>{"Prikaz namjene i zemlje obrade kod planiranog AI pružatelja."}</li>
            </ul>
            <ul>
              <li>{"U Ducturi se promatra dokument, a ne zaslon ili druge aplikacije."}</li>
              <li>{"Student ne mora platiti kako bi ispunio svoju nastavnu obvezu."}</li>
              <li>{"O studentima se ne donose automatske ocjene ni rangiranja."}</li>
              <li>{"Promjene dokumenta ne pretvaraju se u mjere ritma ili brzine tipkanja."}</li>
              <li>{"Privatne mentorove bilješke nisu dio zajedničkog prikaza rada."}</li>
              <li>{"Pravna i sigurnosna priprema potrebna je prije stvarnog pilota."}</li>
            </ul>
          </div>
        </details>
        <details>
          <summary>
            <span className={"number"}>{"11"}</span>{" "}
            <strong>{"Povezivanje i daljnji razvoj"}</strong>
          </summary>
          <div className={"catalogue-content"}>
            <ul>
              <li>
                <strong>{"Planirani AAI@EduHr"}</strong>{" kao institucionalna prijava."}
              </li>
              <li>{"Paket pravila Lekte i bibliografski uvoz iz Zotera."}</li>
              <li>{"Izvoz za potrebe rada s Merlinom u planiranim oblicima."}</li>
              <li>{"Kasnija integracija s Merlinom/Moodleom putem LTI-ja."}</li>
              <li>{"Grupni rad s pripisivanjem doprinosâ planiran je izvan pilota."}</li>
            </ul>
            <ul>
              <li>{"Profili fakulteta diljem Hrvatske prema potvrđenim pravilima pojedine ustanove."}</li>
              <li>{"Otvoreni alat za provjeru cjelovitosti zapisa."}</li>
              <li>{"Transkripcija intervjua i glasovni komentari kao kasnije ideje."}</li>
              <li>{"Moguća povezivanja s Dabarom i ISVU-om razmatraju se za kasnije."}</li>
              <li>{"Predlošci zadataka i dodatni mentorski alati predmet su daljnje razrade."}</li>
            </ul>
            <p className={"context"}>{"Kasniji prijedlozi nemaju potvrđen rok ni automatski odobrenu implementaciju."}</p>
          </div>
        </details>
      </div>
    </div>
  </section>
  <section className={"status"} id={"razvoj"}>
    <div className={"wrap"}>
      <div className={"status-head"}>
        <p className={"smallcaps"}>{"Razvoj proizvoda"}</p>
        <div>
          <h2>{"Gdje je Ductura danas?"}</h2>
          <p className={"status-intro"}>{"Ovdje možete istražiti smjer proizvoda. Stanje pojedinih mogućnosti razlikuje se od prikaza na ovoj stranici."}</p>
        </div>
      </div>
      <div className={"status-list"}>
        <div className={"status-row"}>
          <strong>{"Dostupno na ovoj stranici"}</strong>
          <p>{"Interaktivni prikazi pisanja, komentara, promjena i Lektina kataloga. Oni rade u pregledniku i nisu povezani sa stvarnim korisnicima ni aplikacijom."}</p>
        </div>
        <div className={"status-row"}>
          <strong>{"U razvoju"}</strong>
          <p>{"U projektu postoje dijelovi uređivača, zadataka i komentara. Dostupnost cjelovitog tijeka potrebno je zasebno provjeriti."}</p>
        </div>
        <div className={"status-row"}>
          <strong>{"Planirano"}</strong>
          <p>{"Podrška za pravila i citiranje ovisi o potvrđenom profilu ustanove. Ugrađeni AI pomoćnik planiran je nakon prvog pilota."}</p>
        </div>
        <div className={"status-row"}>
          <strong>{"Prije stvarnog pilota"}</strong>
          <p>{"Potrebni su dogovor s ustanovom te pravni i sigurnosni uvjeti. Prikaz uživo i reprodukcija čekaju i pravno mišljenje te procjenu učinka."}</p>
        </div>
      </div>
      <p className={"status-note"}>{"Oznake opisuju ovu stranicu i smjer razvoja; nisu obećanje roka ili dostupnosti."}</p>
    </div>
  </section>
  <section className={"contact-section"} id={"kontakt"} aria-labelledby={"contact-title"}>
    <div className={"wrap contact-grid"}>
      <div>
        <p className={"smallcaps"}>{"Za ustanove"}</p>
        <h2 id={"contact-title"}>{"Razgovarajmo"}
          <br />
          <em>{"o Ducturi."}</em>
        </h2>
        <p className={"contact-intro"}>{"Recite što je važno vašoj ustanovi. Pripremite kratak upit o pisanju, mentorstvu ili mogućem predstavljanju."}</p>
        <p className={"contact-boundary"}>{"Upit možete pripremiti ovdje i prenijeti u međuspremnik. Kontaktni kanal još nije postavljen, pa se upit s ove stranice ne šalje."}</p>
        <details className={"privacy-inline"}>
          <summary>{"Privatnost na ovoj stranici"}</summary>
          <p>{"Podaci koje upišete ostaju u pregledniku dok je stranica otvorena; stranica ih ne šalje. Na vaš zahtjev tekst se prenosi u međuspremnik uređaja. Ovo objašnjenje odnosi se na ovaj samostalni prikaz."}</p>
        </details>
      </div>
      <form className={"request-form"} id={"request-form"}>
        <div className={"field"}>
          <label htmlFor={"request-institution"}>{"Ustanova "}
            <span>{"(neobavezno)"}</span>
          </label>
          <input id={"request-institution"} maxLength={160} autoComplete={"organization"} placeholder={"Naziv fakulteta ili ustanove"} />
        </div>
        <div className={"field"}>
          <label htmlFor={"request-role"}>{"Vaša uloga "}
            <span>{"(neobavezno)"}</span>
          </label>
          <select id={"request-role"}>
            <option value={""}>{"Odaberite ulogu"}</option>
            <option>{"Nastavnik ili mentor"}</option>
            <option>{"Uprava ustanove"}</option>
            <option>{"IT ili podrška"}</option>
            <option>{"Student"}</option>
            <option>{"Druga uloga"}</option>
          </select>
        </div>
        <div className={"field"}>
          <label htmlFor={"request-topic"}>{"Što vas zanima? "}
            <span>{"(neobavezno)"}</span>
          </label>
          <textarea id={"request-topic"} maxLength={800} placeholder={"Na primjer, upute za radove ili mogući pilot."}></textarea>
        </div>
        <button className={"contact-action"} type={"submit"}>{"Pripremite tekst upita "}<span aria-hidden={true} className={"arrow-right"} /></button>
        <p className={"request-message"}>{"Bez slanja i bez spremanja podataka na poslužitelj."}</p>
        <div className={"request-result"} id={"request-result"} hidden>
          <label htmlFor={"request-output"}>{"Pripremljeni upit"}</label>
          <textarea id={"request-output"} rows={8}></textarea>
          <p className={"request-message"}>{"Tekst možete urediti i prenijeti u međuspremnik. Upit nije poslan."}</p>
          <button className={"copy-button"} type={"button"} id={"request-copy"}>{"Kopirajte tekst"}</button>
          <p className={"request-feedback"} id={"request-feedback"} role={"status"}></p>
        </div>
      </form>
    </div>
  </section>
  <section className={"faq"} aria-labelledby={"faq-title"}>
    <div className={"wrap faq-grid"}>
      <div>
        <p className={"smallcaps"}>{"O Ducturi"}</p>
        <h2 id={"faq-title"}>{"Najčešća pitanja."}</h2>
      </div>
      <div className={"faq-list"}>
        <details>
          <summary>{"Je li ovo stvarni studentski rad?"}</summary>
          <p>{"Nije. Tekst je izmišljen, a promjene i komentari ostaju u vašem pregledniku samo dok je stranica otvorena. Primjer nije povezan s Ducturom ili fakultetom."}</p>
        </details>
        <details>
          <summary>{"Može li Ductura utvrditi tko je napisao rad?"}</summary>
          <p>{"Ne. Na temelju zapisa Ductura ne procjenjuje autorstvo. Zaključak i razgovor uvijek pripadaju ljudima."}</p>
        </details>
        <details>
          <summary>{"Što student zna prije početka?"}</summary>
          <p>{"Prema pravilima proizvoda, student prije početka dobiva obavijest što se bilježi i tko vidi rad. Predviđeno je da nastavnik zadatka odnosno mentor vidi promjene uživo, uključujući tekst koji student poslije može obrisati, te da može reproducirati nastanak rada. Pilot sa stvarnim studentima čeka pravno mišljenje i procjenu učinka."}</p>
        </details>
        <details>
          <summary>{"Kako fakultet može upoznati Ducturu?"}</summary>
          <p>{"Na stranici možete istražiti viziju i pripremiti tekst upita. Razgovor o uvođenju i mogućem pilotu slijedi nakon uspostave kontaktnog kanala i dogovora s ustanovom."}</p>
        </details>
        <details>
          <summary>{"Je li pilot već započeo?"}</summary>
          <p>{"Ovaj koncept sam po sebi ne znači da je pilot dogovoren ili pokrenut. Plan je najprije pokazati primjer sa sintetičkim podacima, a o stvarnom pilotu razgovarati s ustanovom nakon ispunjavanja uvjeta."}</p>
        </details>
      </div>
    </div>
  </section>
  <section className={"final"}>
    <div className={"wrap"}>
      <p className={"smallcaps"}>{"Isprobajte Ducturu"}</p>
      <h2>{"Upoznajte je"}
        <br />
        <em>{"kroz jedan rad."}</em>
      </h2>
      <p>{"Upišite rečenicu, promijenite pogled i ostavite komentar."}</p>
      <a href={"#primjer"}>{"Istražite radni prostor "}
        <span aria-hidden={"true"}><span aria-hidden={true} className={"arrow-up-right"} /></span>
      </a>
    </div>
  </section>
</main>
<footer>
  <div className={"wrap footer-inner"}>
    <div className={"footer-brand"}>{"ductura."}</div>
    <p className={"footer-note"}>{"Ductura · Proizvod u razvoju"}</p>
    <div className={"footer-links"}>
      <a href={"#studenti"}>{"Za studente"}</a>
      <a href={"#fakulteti"}>{"Za fakultete"}</a>
      <a href={"#povjerenje"}>{"Povjerenje"}</a>
      <a href={"#razvoj"}>{"Razvoj"}</a>
      <a href={"#kontakt"}>{"Upit"}</a>
      <a href={"/prijava"}>{"Prijava"}</a>
    </div>
  </div>
</footer>
<dialog id={"faculty-dialog"} aria-labelledby={"dialog-title"}>
  <div className={"dialog-body"}>
    <p className={"smallcaps"}>{"Za fakultete"}</p>
    <h2 id={"dialog-title"}>{"Predstavljanje fakultetu."}</h2>
    <p>{"U predstavljanju se prolazi primjer rada iz studentske i nastavničke perspektive te razgovara o pravilima ustanove i uvjetima mogućeg pilota."}</p>
    <p>{"Mogući pilot zahtijeva dogovor s ustanovom i ispunjavanje potrebnih uvjeta."}</p>
    <a href={"#kontakt"} id={"dialog-contact"}>{"Pripremite upit "}<span aria-hidden={true} className={"arrow-right"} /></a>
    <br />
    <button type={"button"} id={"close-dialog"}>{"Zatvori"}</button>
  </div>
</dialog>
  </>);
}
