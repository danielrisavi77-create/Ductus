# Ductura: Functional Architecture v1

Verzija 1.0 · 5. 10. 2026.  
Status: kandidat za kanonski funkcionalni model  
Nadređeno: `docs/PRODUCT_SPEC_V1.md`, `docs/PRODUCT.md`, `docs/DECISIONS.md`  
Tehnička implementacija: `docs/ARCHITECTURE.md`, `docs/BACKEND.md`  
Vlasnik proizvoda: Daniel Rišavi

---

# 0. Svrha

Ovaj dokument definira **kako Ductura funkcionira kao sustav**, ne kako izgleda.

Cilj je prije daljnjeg UI rada zaključati:

- domenske entitete;
- odnose među entitetima;
- state machineove;
- pravila prijelaza;
- ovlasti;
- event model;
- provenance/genealogiju sadržaja;
- policy inheritance;
- verzije i lifecycle rada;
- collaboration model;
- submission lifecycle;
- evidence/case model;
- integracije;
- failure/recovery logiku;
- ključne invariants;
- granice između product slojeva.

Vizualni dizajn je sekundaran ovom dokumentu. UI smije predstavljati samo stanja i akcije koje Functional Architecture dopušta.

---

# 1. Produkt kao skup osam enginea

Ductura se funkcionalno sastoji od osam glavnih enginea:

1. **Academic Work Engine**  
   Zadaci, radovi, dokument, spremanje, offline rad, verzije, rekonstrukcija i predaja.

2. **Provenance Engine**  
   Podrijetlo teksta i genealogija sadržaja kroz opažene i izjavljene događaje.

3. **Workflow Engine**  
   Lifecycle nacrta, pregleda, dorada, odobrenja, predaje i obrane.

4. **Policy Engine**  
   Institucionalna pravila, inheritance, verzioniranje i snapshot pri predaji.

5. **Collaboration Engine**  
   Komentari, prijedlozi, izmjene, zahtjevi za doradu, konzultacije i approval.

6. **Evidence / Case Engine**  
   Evidence package, žalbe, pravno zadržavanje, povjerenstva i audit.

7. **Institution Operations Engine**  
   Fakulteti, kolegiji, korisnici, uloge, retention, audit, sigurnost i operacije.

8. **Integration Engine**  
   AAI@EduHr, Merlin/Moodle, Zotero, DOCX/PDF, e-mail, kasnije ISVU/Dabar/API.

Ovi enginei dijele isti identitet, authorization model i evidence substrate.

## 1.1 Četiri odvojena modela stanja

Ductura ima četiri različita state machinea koji se ne smiju spajati u jedan generički status:

1. **Work state** — akademski napredak rada;
2. **Sync state** — tehnička trajnost aktualne dokumentne revizije;
3. **RevisionRequest state** — lifecycle pojedinačnog zahtjeva za doradu;
4. **SubmissionAttempt state** — tehnička obrada jednog pokušaja konačne predaje.

Primjer: Work može biti `IN_PROGRESS`, dokument istodobno `LOCAL_DURABLE`, jedan zahtjev za doradu `NEEDS_CLARIFICATION`, a prethodni SubmissionAttempt `RETRY_PENDING`. Nijedno od tih stanja ne implicira drugo.

**UI pravilo:** korisniku se ne smije prikazivati zajednički status ako iza njega nije jednoznačno poznato kojem od četiri modela pripada.

---

# 2. Domenski model

## 2.1 Organizacijski entiteti

### Institution

Predstavlja fakultet ili sveučilišnu sastavnicu.

Ključna polja:

- `institution_id`
- `name`
- `slug`
- `aai_home_org`
- `default_language`
- `timezone`
- `status`
- `created_at`

Veze:

- Institution 1:N StudyProgramme
- Institution 1:N Course
- Institution 1:N InstitutionMembership
- Institution 1:N PolicySet
- Institution 1:N RetentionPolicy
- Institution 1:N IntegrationConnection

### StudyProgramme

- `programme_id`
- `institution_id`
- naziv
- razina studija
- jezik
- aktivno razdoblje

### AcademicYear

- `academic_year_id`
- oznaka, npr. 2026/2027
- početak / kraj
- status

### Course

- `course_id`
- `institution_id`
- `programme_id?`
- `academic_year_id`
- naziv
- šifra
- jezik rada
- course policy reference
- status

### CourseMembership

Predstavlja odnos korisnika i kolegija.

- `course_id`
- `user_id`
- role: student | teacher | assistant
- valid_from
- valid_until
- status

---

## 2.2 Identitet i uloge

### User

Identitet je institucionalan.

- `user_id`
- `issuer`
- `hrEduPersonUniqueID`
- `sub`
- display_name
- email?
- home_org
- affiliation
- locale
- status

Nikad automatsko spajanje po e-mailu.

### InstitutionMembership

- `user_id`
- `institution_id`
- role:
  - institution_admin
  - teacher
  - mentor
  - student
  - support_delegate
- verified_by
- valid_from
- valid_until
- status

Uloga sama po sebi **ne daje pristup sadržaju rada**. Pristup nastaje iz konkretnog odnosa prema Course/Assignment/Work/Case.

---

# 3. Assignment model

## 3.1 Assignment

Zadatak je verzionirana konfiguracija akademske obveze.

Polja:

- `assignment_id`
- `course_id`
- title
- description
- work_type
- open_at
- due_at
- target_word_count?
- min_word_count?
- max_word_count?
- evidence_profile
- import_policy
- collaboration_mode
- submission_mode
- current_version_id
- status

### WorkType

- short_submission
- essay
- seminar_paper
- bachelor_thesis
- master_thesis
- specialist_thesis
- doctoral_thesis

### EvidenceProfile

- basic
- extended
- mentor_replay_enabled

### AssignmentVersion

Svaka promjena konfiguracije stvara novu immutable verziju.

- `assignment_version_id`
- `assignment_id`
- version_number
- effective_from
- created_by
- instructions_snapshot
- policy_snapshot_ref
- formatting_profile_ref
- evidence_profile
- import rules
- collaboration rules
- submission rules
- retention disclosure
- hash

Kad student potvrdi verziju, ona za njegov Work postaje frozen baseline. Potvrda stvara `WorkPolicyBaseline` i veže Work uz konkretne source-version ID-eve. Kasnija nova verzija Assignmenta ili parent policyja **ne može** promijeniti aktivni baseline postojećeg Worka samo zato što je kasnije stupila na snagu.

### WorkPolicyBaseline

- `work_policy_baseline_id`
- `work_id`
- `assignment_version_id`
- `source_policy_version_ids[]`
- `resolved_snapshot_hash`
- `acknowledged_at`
- `acknowledged_by`
- `tracking_profile_hash`
- `created_at`

Dopuštena migracija postojećeg Worka na noviji policy zahtijeva zaseban command, audit i dokaz da promjena **ne proširuje** tracking/evidence obveze u odnosu na potvrđeni baseline. Ako promjena zahtijeva novu potvrdu, sama potvrda ne smije zaobići zabranu retroaktivnog proširenja praćenja.

---

# 4. Policy Engine

## 4.1 Hijerarhija

Policy resolution ide:

```
Institution Policy
        ↓
Study Programme Policy (optional)
        ↓
Course Policy
        ↓
Assignment Policy
```

Niža razina može:

- naslijediti;
- suziti;
- specificirati dopušteno ponašanje;
- ne smije proširiti ovlasti ako parent policy to zabranjuje.

## 4.2 PolicySet

- `policy_set_id`
- scope_type
- scope_id
- version
- effective_from
- effective_until?
- status
- created_by

### PolicyRule

- `policy_rule_id`
- category
- subject
- effect:
  - allowed
  - must_declare
  - prohibited
  - required
- parameters JSON
- source_reference?
- explanation
- priority

Primjeri subjecta:

- ai.brainstorming
- ai.language_correction
- ai.translation
- ai.generate_text
- import.docx
- import.pdf
- review.required
- replay.enabled
- citation.style
- word_count
- retention.work_content

## 4.3 Resolution

Postoje dvije odvojene operacije:

### A. `resolvePolicyForNewAssignmentVersion(scope, at_time)`

Koristi policy verzije važeće u `at_time` i gradi snapshot za **novu** AssignmentVersion / nove Workove.

### B. `getEffectivePolicyForWork(work_id)`

Za postojeći Work polazi isključivo od njegova potvrđenog `WorkPolicyBaseline`a i njegovih source-version ID-eva. Ne resolva ponovno parent policy prema trenutnom vremenu.

Pravila:

1. novi AssignmentVersion koristi policy verzije važeće u trenutku objave;
2. postojeći Work koristi potvrđeni baseline;
3. child ne smije proširiti parent prohibition;
4. konflikt koji se ne može deterministički riješiti = configuration error;
5. svaka dopuštena migracija postojećeg Worka mora biti narrowing-only za tracking/evidence obveze, eksplicitno autorizirana i auditirana;
6. student prije rada vidi točno baseline koji potvrđuje;
7. finalna predaja sprema immutable `SubmissionPolicySnapshot` izveden iz baselinea tog Worka, ne iz trenutačnog parent policyja.

## 4.4 SubmissionPolicySnapshot

- resolved rules;
- source policy versions;
- assignment version;
- formatting profile;
- AI/declaration requirements;
- retention rules;
- hash;
- created_at.

Ovo je dio Evidence Packagea.

---

# 5. Academic Work Engine

## 5.1 Work

Jedan studentov ili mentorski rad vezan uz Assignment.

- `work_id`
- `assignment_id`
- `student_id`
- `assignment_version_id`
- `effective_policy_snapshot_id`
- `document_id`
- status
- opened_at
- started_at?
- final_submitted_at?
- current_revision
- current_version_id?
- adaptation_flag?
- legal_hold?

## 5.2 Work state machine

Osnovni state machine:

```
NOT_STARTED
    ↓ acknowledge assignment
READY
    ↓ first document event
IN_PROGRESS
    ↓ send draft/review version
SUBMITTED_FOR_REVIEW
    ↓ reviewer opens
IN_REVIEW
    ↓ revision requested
REVISION_REQUESTED
    ↓ student resumes
REVISING
    ↓ resubmit
RESUBMITTED
    ↓ reviewer accepts
APPROVED_FOR_FINAL
    ↓ final submit
FINAL_SUBMISSION_PENDING
    ↓ exact reconstruction + receipt
FINAL_SUBMITTED
    ↓ optional defense workflow
DEFENSE_PENDING
    ↓ defense complete
COMPLETED
    ↓ retention lifecycle
ARCHIVED
```

Ne koriste svi radovi sva stanja.

Short assignment može ići:

`NOT_STARTED → READY → IN_PROGRESS → FINAL_SUBMISSION_PENDING → FINAL_SUBMITTED`

### 5.2.1 Normativna tablica prijelaza

| Current | Command / event | Actor | Guard | Next |
| --- | --- | --- | --- | --- |
| NOT_STARTED | AcknowledgeAssignment | student | prikazana konkretna AssignmentVersion | READY |
| READY | first accepted document event | student | baseline potvrđen | IN_PROGRESS |
| IN_PROGRESS | SendVersionForReview | student | workflow dopušta review; ciljna verzija durable | SUBMITTED_FOR_REVIEW |
| SUBMITTED_FOR_REVIEW | OpenReview | reviewer | valjan relation prema toj verziji | IN_REVIEW |
| IN_REVIEW | RequestRevision | reviewer | konkretna version/range osnova | REVISION_REQUESTED |
| IN_REVIEW | ApproveDraft | reviewer | workflow dopušta approval | APPROVED_FOR_FINAL |
| REVISION_REQUESTED | ResumeRevision | student | zahtjev aktivan | REVISING |
| REVISING | ResubmitForReview | student | nova frozen verzija | RESUBMITTED |
| RESUBMITTED | OpenReview | reviewer | valjan relation | IN_REVIEW |
| RESUBMITTED | RequestRevision | reviewer | nova pregledana verzija | REVISION_REQUESTED |
| RESUBMITTED | ApproveDraft | reviewer | workflow dopušta approval | APPROVED_FOR_FINAL |
| APPROVED_FOR_FINAL | RequestFinalSubmission | student | odobrena ciljna verzija nije promijenjena; declaration preduvjeti zadovoljeni | FINAL_SUBMISSION_PENDING |
| IN_PROGRESS | RequestFinalSubmission | student | short/no-review workflow dopušta | FINAL_SUBMISSION_PENDING |
| FINAL_SUBMISSION_PENDING | SubmissionCompleted | system | canonical Submission = SUBMITTED | FINAL_SUBMITTED |
| FINAL_SUBMISSION_PENDING | SubmissionRetryableFailure | system | attempt ostaje isti | FINAL_SUBMISSION_PENDING |
| FINAL_SUBMISSION_PENDING | SubmissionMismatch | system | mismatch/fallback zapis postoji | FINAL_SUBMISSION_PENDING |
| FINAL_SUBMITTED | OpenDefense | authorized actor/system | workflow ima obranu | DEFENSE_PENDING |
| DEFENSE_PENDING | CompleteDefense | authorized actor | uvjeti obrane završeni | COMPLETED |
| FINAL_SUBMITTED | CompleteWork | system/authorized actor | nema obrane ili workflow završava predajom | COMPLETED |
| COMPLETED | ArchiveWork | system | retention/hold provjera | ARCHIVED |

Review/revision petlja može se ponavljati proizvoljan broj puta. `OpenReview` nikad nije akademsko odobrenje.

Ako se sadržaj odobrene ciljne verzije naknadno promijeni, approval se ne prenosi na novu reviziju; Work se vraća u stanje koje workflow definira za novi pregled ili se traži novo odobrenje.

## 5.3 Zabranjeni prijelazi

- FINAL_SUBMITTED → IN_PROGRESS bez formalne reopen akcije;
- ARCHIVED → editable;
- student ne može preskočiti required declaration;
- final submission ne postoji bez reconstruction joba;
- assignment policy ne može retroaktivno proširiti praćenje već započetog Worka.

---

# 6. Document model

## 6.1 Document

- `document_id`
- `work_id`
- schema_version
- current_revision
- current_content_hash
- current_checkpoint_ref
- updated_at

## 6.2 Revision

Revision je logička CAS sekvenca, ne UI verzija.

- revision_number
- previous_revision
- resulting_hash
- accepted_at
- receipt_status

## 6.3 Version

Version je akademski snapshot koji korisnik razumije.

- `version_id`
- `work_id`
- version_number
- kind:
  - autosnapshot
  - draft
  - sent_for_review
  - revision_response
  - prefinal
  - final
- document_revision
- content_hash
- created_by
- created_at
- message?
- frozen

Revision i Version nisu isto.

---

# 7. Offline, sync i recovery

## 7.1 Lokalni journal

Svaki lokalni edit prvo ide u journal na uređaju.

**Sync state nije Work state.** Postojeći kod već modelira korisnička sync stanja poput `EDITING`, `SAVING_LOCAL`, `LOCAL_DURABLE`, `SYNCING`, `SYNCED`, `CONFLICT`, `ERROR` i `RECOVERY_REQUIRED`. Ni jedno ne mijenja akademski status Worka samo po sebi.

Interna stanja događaja/journala:

- LOCAL_ONLY
- RESERVED
- COMMITTED
- RECEIPT_PENDING
- SYNCED
- CONFLICTED
- SALVAGE_REQUIRED

## 7.2 Sinkronizacija

Klijent:

1. pripremi canonical event batch;
2. šalje expected revision;
3. server atomically reserve + commit;
4. worker potpisuje receipt;
5. klijent označava SYNCED tek kad dobije valjanu potvrdu.

## 7.3 Conflict model

Ako server revision != expected revision:

- automatski rebase samo ako je deterministički siguran;
- inače recovery branch;
- korisnik nikad ne gubi lokalni tekst;
- salvage view mora pokazati local vs server;
- evidence za offline ostaje označen offline.

## 7.4 Multi-device rule

Jedan Work može biti otvoren na više uređaja, ali:

- svaki device/session ima ID;
- server revision je jedini canonical order;
- optimistic CAS sprječava silent overwrite;
- konflikt se nikad ne rješava “last write wins” nad akademskim sadržajem.

---

# 8. Event model

## 8.1 Event families

### Document events

- text_insert
- text_delete
- text_replace
- paste
- cut
- undo
- redo
- block_insert
- block_delete
- structure_change
- format_change
- citation_insert
- citation_update
- footnote_insert
- table_change
- figure_change

### Source/provenance events

- import_document
- import_source
- paste_source_declared
- ai_transfer
- source_quote_insert
- provenance_annotation
- provenance_annotation_correction

### Collaboration events

- comment_create
- comment_reply
- comment_publish
- suggestion_create
- suggestion_accept
- suggestion_reject
- direct_edit_apply
- revision_request_create
- revision_request_resolve
- consultation_record_create

### Workflow events

- assignment_acknowledged
- work_started
- version_created
- version_sent_for_review
- review_opened
- revision_requested
- final_submission_requested
- final_submission_completed
- deadline_extended
- defense_access_granted
- defense_access_revoked
- work_archived

### System/evidence events

- sync_gap_detected
- recovery_performed
- receipt_signed
- reconstruction_started
- reconstruction_completed
- export_created
- access_recorded
- retention_action
- legal_hold_set
- legal_hold_released

## 8.2 Event envelope

Svaki događaj ima:

- event_id
- schema_version
- work_id
- document_id
- actor_id
- actor_role
- device_id
- session_id
- observed_at
- accepted_at
- offline
- event_type
- payload
- previous_hash
- event_hash

Unknown fields se odbijaju na granici za evidence-critical schema.

---

# 9. Provenance Engine

## 9.1 Tri osi atribucije

Svaki relevantan segment može imati tri odvojena podatka:

1. **Actor attribution**  
   Koji račun/uloga je izveo opaženu radnju.

2. **Observed action**  
   Što je Ductura opažala: typed/inserted/pasted/imported/AI transfer/mentor edit itd.

3. **Declared source**  
   Što korisnik kaže da je izvor sadržaja.

Nikad se declared source ne pretvara u observed fact.

## 9.2 Provenance node

- `provenance_node_id`
- work_id
- document_range_ref
- originating_event_id
- actor attribution
- observed action
- declared source?
- parent_nodes[]
- supersedes?
- active_from_revision
- active_until_revision?

## 9.3 Genealogija segmenta

Primjer:

```
Student text insert
   ↓
Mentor suggestion
   ↓
Student accepts
   ↓
Student rewrites 30%
   ↓
Final paragraph
```

Finalni segment može imati DAG više parenta.

## 9.4 Transformacije

Transformacija ne briše prethodno podrijetlo.

Vrste:

- copied
- edited
- merged
- split
- paraphrased-by-user-observed-as-edit
- mentor-modified
- AI-transferred
- imported
- restored

## 9.5 Unknown provenance

Ako Ductura ne zna podrijetlo sadržaja, to je eksplicitno stanje:

`UNKNOWN_OBSERVED_ORIGIN`

Ne izmišlja se uzrok.

Owner-design semantics iz Product Speca mogu prikazivati udio/postotak, ali engine izvorno čuva samo event/range činjenice; aggregation je presentation/query sloj.

---

# 10. Reconstruction Engine

## 10.1 Cilj

Za svaki revision mora vrijediti:

`replay(events[0..n]) == canonical_document_revision_n`

## 10.2 ReconstructionResult

- status:
  - exact
  - exact_with_gaps
  - mismatch
  - unavailable
- reconstructed_hash
- expected_hash
- gap_count
- first_failure_event?
- verified_at
- engine_version

## 10.3 Invariant

Final submission smije završiti samo ako:

`status == exact || status == exact_with_gaps`

i reconstructed_hash == submitted_hash.

Gap je rupa u povijesti, ne mismatch dokumenta.

---

# 11. Submission Engine

## 11.1 SubmissionAttempt

Klik na “Predaj” odmah stvara:

- submission_attempt_id
- work_id
- requested_at = DB clock
- requested_by
- target_document_revision
- target_document_hash
- policy_snapshot_id
- status

## 11.2 Submission state machine

```
REQUESTED
   ↓
RECONSTRUCTING
   ├── mismatch → BLOCKED_MISMATCH
   │                  └── fallback / corrected target → NEW ATTEMPT ili incident flow
   ├── system failure → RETRY_PENDING
   │                       └── retry ISTOG attempta → RECONSTRUCTING
   └── exact | exact_with_gaps + hash match → DECLARATION_CHECK
                                                  ↓
                                             RECEIPT_PENDING
                                                  ↓
                                               SUBMITTED
```

### SubmissionAttempt invariants

Retry istog attempta **ne mijenja**:

- `submission_attempt_id`;
- `requested_at`;
- `target_document_revision`;
- `target_document_hash`;
- `policy_snapshot_id`.

`exact_with_gaps` može nastaviti samo ako reconstruction engine potvrdi isti finalni hash i ako su gapovi prikazani prema product pravilima.

`BLOCKED_MISMATCH` nije tehnički kvar. Ne smije automatski retryati isti target kao da je worker pao. Potreban je eksplicitni fallback/incident tok: korisniku se objašnjava da ciljna revizija nije dokazivo rekonstruirana, a eventualni novi pokušaj dobiva novi attempt ID i jasno zamrznut target.

`RETRY_PENDING` je tehnički kvar. Worker može idempotentno ponovno obraditi isti attempt.

## 11.3 Vrijeme zahtjeva

`requested_at` nastaje pri **server-side prihvatu zahtjeva u bazi**, iz DB sata. Offline klik sam po sebi ne stvara `requested_at`.

Za Ducturinu tehničku logiku rokova koristi se upravo taj zabilježeni trenutak prihvata. Hoće li ga ustanova pravno tretirati kao mjerodavan trenutak predaje potvrđuje se u institucionalnim pravilima i GO dokumentaciji; Functional Architecture ne daje samostalnu pravnu tvrdnju.

Kasniji završetak workera ne mijenja izvorni `requested_at` istog attempta.

## 11.4 Submission

Immutable:

- submission_id
- work_id
- assignment_version
- final document hash
- requested_at
- completed_at
- reconstruction result
- declaration snapshot
- policy snapshot
- receipt
- exported file hashes
- evidence manifest ref

---

# 12. Declaration model

## 12.1 Declaration

Studentova izjava je zaseban versioned objekt.

Sadrži:

- used tools;
- provider/model;
- purpose;
- phase of work;
- external AI;
- attached conversations;
- human assistance;
- adaptation/tooling;
- free-text note;
- confirmed_at.

## 12.2 Observed vs declared

Izjava nikad ne mijenja original evidence event.

Primjer:

- observed: paste >200 chars, source unknown
- declared later: “vlastite bilješke”

Oba ostaju vidljiva kao dvije činjenice.

---

# 13. Collaboration Engine

## 13.1 CommentThread

- target document/range
- author
- visibility
- publish_state
- status open/resolved
- messages

## 13.2 Suggestion

- base revision
- range
- proposed replacement
- author
- status:
  - open
  - accepted
  - rejected
  - superseded
- accepted_by
- resulting event IDs

## 13.3 DirectEdit

Tehnički se modelira kao Suggestion + automatic apply uz eksplicitnu konfiguraciju.

Svaki direct edit ostaje atribuibran nastavniku/mentoru.

## 13.4 RevisionRequest

Functional Architecture **ne uvodi konkurentski lifecycle** postojećem domenskom modulu. Kanonska početna stanja iz `src/domain/collaboration/revision-request.ts` su:

- `OPEN`
- `STUDENT_RESPONDED`
- `SHARED_FOR_REVIEW`
- `ACCEPTED_FOR_REVISION`
- `NEEDS_CLARIFICATION`
- `REREVIEW_REQUIRED`

Ciljni model dodaje samo stanja potrebna za zatvaranje lifecyclea, uz zaseban code task i testove:

- `RESOLVED`
- `WITHDRAWN`

Minimalni podaci:

- request_id
- work_id
- document_id
- requested_revision
- reviewed_version_id?
- target anchor/range
- instruction
- created_by
- due_at?
- response
- accepted_revision?
- resolved_in_version_id?
- status

### Normativni prijelazi

| Current | Akcija | Next |
| --- | --- | --- |
| OPEN | student odgovori s revision >= requested_revision | STUDENT_RESPONDED |
| NEEDS_CLARIFICATION | student dopuni odgovor | STUDENT_RESPONDED |
| STUDENT_RESPONDED | student podijeli odgovor za pregled | SHARED_FOR_REVIEW |
| SHARED_FOR_REVIEW | reviewer traži pojašnjenje | NEEDS_CLARIFICATION |
| SHARED_FOR_REVIEW | reviewer prihvati odgovor za doradu | ACCEPTED_FOR_REVISION |
| ACCEPTED_FOR_REVISION | relevantni prihvaćeni range/anchor naknadno se promijeni | REREVIEW_REQUIRED |
| REREVIEW_REQUIRED | student podijeli novu verziju/odgovor | SHARED_FOR_REVIEW |
| SHARED_FOR_REVIEW | reviewer potvrdi da je konkretna pregledana verzija zadovoljila zahtjev | RESOLVED |
| OPEN / NEEDS_CLARIFICATION / STUDENT_RESPONDED / SHARED_FOR_REVIEW | ovlašteni reviewer povuče zahtjev | WITHDRAWN |

`changed` nije status prihvata. Promjena teksta je evidence/document činjenica. `RESOLVED` je dopušten samo uz `resolved_in_version_id` koji je reviewer stvarno pregledao.

Ako se nakon `RESOLVED` promijeni relevantni range, originalni resolution zapis ostaje auditiran, a sustav otvara novi review zahtjev ili novu generaciju zahtjeva prema workflowu; ne prepisuje povijesni resolution.

## 13.5 ConsultationRecord

- work_id
- version_id
- held_at
- participants
- summary
- follow_up
- created_by

Ne služi ocjenjivanju.

---

# 14. Workflow Engine

## 14.1 WorkflowTemplate

Fakultet/vrsta rada može imati workflow template.

Primjer master thesis:

1. Topic proposed
2. Topic approved
3. Outline
4. Draft 1
5. Mentor review
6. Draft 2
7. Prefinal
8. Final submission
9. Defense
10. Archive

## 14.2 WorkflowInstance

Svaki Work može instancirati template.

### Milestone

- milestone_id
- type
- title
- required
- due_at?
- status
- completion_rule
- approved_by?
- completed_at?

## 14.3 Approval

- object_type
- object_id
- reviewer
- decision:
  - approved
  - changes_requested
  - rejected
- note
- decided_at

Workflow ne smije implicitno mijenjati evidence rules.

---

# 15. Progress Engine

Studentov productivity sloj računa iz normalnih akademskih činjenica, ne iz behavioral surveillancea.

Podaci:

- target words;
- current words;
- chapter targets;
- chapter completion;
- milestones;
- days to deadline;
- draft states;
- open revision requests.

Moguća projekcija završetka smije koristiti coarse version history, ali ne fine typing rhythm podatke.

---

# 16. Template Engine

## 16.1 AcademicTemplate

- template_id
- institution/course/work_type
- version
- title-page template
- required sections
- optional sections
- chapter targets
- citation profile
- formatting profile
- declaration template
- default workflow template

## 16.2 Instantiation

Kad student pokrene Work:

- template version se snapshotira;
- početna document structure se generira;
- kasnija promjena templatea ne prepisuje postojeći Work.

---

# 17. Permission model

## 17.1 Princip

Authorization je relation-based.

Uloga je samo jedan input.

Funkcija:

`can(actor, action, object, now)`

## 17.2 Ključne sposobnosti

### Student

Za vlastiti Work:

- read_document
- edit_document
- read_evidence
- annotate_evidence
- read_comments
- respond_comments
- create_version
- request_submission
- export_work
- export_evidence
- read_access_log

### Teacher

Samo kroz Course/Assignment relation:

- read_current_saved_state
- read_evidence
- comment
- suggest
- direct_edit_if_enabled
- create_revision_request
- extend_deadline
- read_submission
- export_submission

### Mentor

Kao teacher + mentor-only workflow:

- consultation record
- replay if enabled
- milestone approval
- defense preparation

### Institution admin

- manage users/roles
- manage policies
- manage retention
- manage integrations
- read audit metadata

Nema default:
- read_document
- read_evidence content

### Committee reviewer

Samo ako postoji grant:

- work_id/case_id scoped
- valid_from
- valid_until
- revocable
- auto-expire

## 17.3 Support access

Operator/support access mora biti:

- explicit;
- scoped;
- time-limited;
- logged;
- uz institucionalno odobrenje prema ugovoru.

---

# 18. Access Audit

Svako osjetljivo čitanje piše:

- audit_event_id
- actor
- role
- action
- object
- reason/context
- occurred_at
- session
- institution

Student može vidjeti pristupe svom radu prema product pravilima.

Audit log je append-only na aplikacijskoj razini.

---

# 19. Evidence / Case Engine

## 19.1 Case

- case_id
- institution_id
- work_id
- type:
  - appeal
  - academic_review
  - student_request
  - defense
  - administrative_review
- reason
- opened_by
- opened_at
- status:
  - open
  - evidence_locked
  - under_review
  - awaiting_response
  - resolved
  - closed
- legal_hold
- closed_at?

## 19.2 CaseParticipant

- case_id
- user_id
- role
- valid_from
- valid_until
- revoked_at?
- permissions

## 19.3 EvidencePackage

Immutable snapshot.

Sadrži:

- final/submitted document;
- selected prior versions;
- reconstruction result;
- relevant event timeline;
- provenance summary;
- declaration snapshot;
- policy snapshot;
- assignment snapshot;
- access audit excerpt;
- comments/revision requests if in scope;
- consultation records if in scope;
- cryptographic receipts;
- exported hashes;
- manifest.

## 19.4 Package states

- BUILDING
- SEALED
- EXPORTED
- SUPERSEDED

Nakon SEALED sadržaj se ne mijenja. Nova dopuna = novi package version.

---

# 20. Retention i legal hold

## 20.1 Data classes

Najmanje:

- work_content
- evidence_events
- replay_timing
- comments
- declarations
- access_logs
- receipts
- exports
- identity_sessions

Svaka ima:

- retention period;
- legal basis;
- deletion semantics;
- backup expiry semantics.

## 20.2 Legal hold

Legal hold:

- vezan uz Work ili Case;
- zaustavlja normalno brisanje samo određenih data classes;
- ima razlog;
- postavlja ovlaštena osoba;
- svaki set/release ide u audit.

### 20.2.1 Concurrency / destructive-delete fence

Retention selection nije dovoljan dokaz da se objekt još smije brisati.

Svaka destruktivna granica (DB delete, S3/object version delete, backup-expiry enqueue gdje je primjenjivo) mora neposredno prije nepovratne radnje ponovno provjeriti:

- aktualni `legal_hold`;
- `retention_generation` / expected generation;
- identitet data classa i objekta.

Normativni guard:

`DELETE iff legal_hold == false AND retention_generation == expected_generation`

`SetLegalHold` atomically povećava generation/fence vrijednost prije nego potvrdi uspjeh. Job koji je selektirao objekt prije toga, ali dođe na delete nakon promjene generationa, mora abortirati/no-op i ponovno evaluirati.

Ponovljeni retention job mora biti idempotentan.

Ako je nepovratno brisanje već završilo prije uspješnog linearization pointa `SetLegalHold`, sustav ne smije naknadno tvrditi da je hold zaštitio već izgubljeni sadržaj; incident se auditira i primjenjuju se backup/restore pravila ako su još dostupna.

---

# 21. Integration Engine

## 21.1 AAI@EduHr

Inbound:

- authentication
- identity attributes
- affiliation
- home organisation

Ne daje automatski content permissions.

## 21.2 Merlin / Moodle

Minimalni model:

Inbound:
- course
- roster
- teacher
- assignment metadata

Outbound:
- submission status
- final artifact
- receipt
- deep link to Ductura review

Preferira se standardizirani adapter; LTI nakon pilota gdje je opravdano.

### 21.2.1 Inbound ordering, authority i idempotency

Svaki inbound integration event nosi najmanje:

- `connection_id`
- `institution_id`
- `source_object_id`
- `source_version` ili drugi monotoni freshness token
- `external_event_id`
- `received_at`
- `payload_hash`

Pravila:

1. isti `connection_id + external_event_id` i isti `payload_hash` = idempotentni no-op;
2. isti event ID s drugim payload hashom = reject + audit;
3. starija `source_version` od već primijenjene = stale reject ili reconciliation queue, nikad silent overwrite;
4. integracijski roster može predložiti relation promjenu, ali ne smije zaobići Ductura authorization/institution governance;
5. lokalni eksplicitni revoke ima definiran authority/fence i ne smije ga ponovno aktivirati stariji inbound roster;
6. integracija sama ne može dodijeliti content access izvan relation modela;
7. outbound/inbound callback ne može dovršiti canonical Submission niti mutirati sealed evidence; canonical submission i dalje zahtijeva reconstruction + declaration + receipt;
8. duplicate submission/status callbackovi koriste stable submission/external ID i ne stvaraju novu predaju.

## 21.3 Zotero

Import:

- BibTeX
- RIS
- CSL-JSON

Nikad ne treba vlastiti puni reference manager ako interoperabilnost rješava potrebu.

## 21.4 DOCX/PDF

Import je označen event.

Export:
- DOCX
- PDF
- receipt PDF
- evidence ZIP

Hash svakog finalnog izvoza može biti vezan uz submission.

## 21.5 ISVU / Dabar

Kasnije adapteri.

Ne smiju postati blocking dependency jezgre.

---

# 22. Notification Engine

Tipovi:

- comment published
- revision requested
- version submitted
- deadline approaching
- deadline extended
- submission completed
- case access granted
- case access expiring
- system incident relevant to work

Preference:

- immediate
- digest
- in-app only

Notification payload ne smije sadržavati osjetljiv radni tekst.

---

# 23. Failure model

## 23.1 Web unavailable

- editor nastavlja lokalno;
- status jasno kaže local only;
- sync retry;
- ako kvar traje prema policyju, fallback procedure.

## 23.2 Worker unavailable

- ingest može nastaviti;
- receipts pending;
- submission worker retry;
- user nikad ne vidi final “submitted” prije stvarnog completiona.

## 23.3 Database unavailable

- server write ne uspijeva;
- lokalni journal čuva rad;
- nema lažnog “server saved”.

## 23.4 Object storage unavailable

- event/content commit koji zahtijeva object storage mora fail closed;
- ne stvara se nepotpuna potvrda.

## 23.5 KMS unavailable

- receipt pending;
- original accepted event ostaje;
- isti receipt se kasnije potpisuje.

## 23.6 Reconstruction failure

- mismatch ≠ system error;
- mismatch blokira final submission;
- system error ide retry/fallback postupkom;
- requested_at ostaje očuvan.

---

# 24. Global invariants

1. Nijedan Work ne postoji bez Assignmenta i studenta.
2. Nijedan evidence event ne postoji bez Worka i actor konteksta.
3. Server revision je monoton.
4. Event hash chain se ne prepisuje.
5. Exact reconstruction koristi isti semantički model dokumenta kao editor.
6. Final submission referencira točno jedan immutable target revision.
7. Submission policy snapshot je immutable.
8. Assignment tracking rules se ne proširuju retroaktivno za započeti Work.
9. Student može vidjeti relevantan evidence prikaz svog rada.
10. Admin nema implicitni pristup sadržaju.
11. Committee access je scoped i vremenski ograničen.
12. Declared source ne mijenja observed event.
13. Legal hold ne briše originalni retention policy; samo privremeno suspendira izvršenje.
14. Offline ostaje provenance činjenica i nakon synca.
15. Export mora biti vezan uz hash sadržaja iz kojeg je nastao.
16. UI stanje “predano” postoji tek nakon završene canonical submission transakcije.
17. “Spremljeno na poslužitelju” / `SYNCED` za evidence-critical tok postoji tek kada aktualna revizija ima valjanu server potvrdu prema sync ugovoru; potvrda stare revizije ne smije označiti novu reviziju sinkroniziranom.
18. Existing Work policy se čita iz potvrđenog WorkPolicyBaselinea; novi parent policy ne mijenja ga retroaktivno.
19. Retry tehnički ne stvara novi SubmissionAttempt niti mijenja requested_at/target/hash/policy.
20. Legal hold i retention delete imaju generation/fence provjeru na destruktivnoj granici.
21. Inbound integration event mora imati freshness + idempotency identitet; stale event ne može vratiti opozvani odnos.
22. REUSE backlog ne smije otvoriti drugi konkurentski implementation source of truth.
23. Product-owner mockup semantics iz Product Speca ostaju zaseban presentation/governance sloj dok konflikti nisu formalno riješeni.
24. Nijedan AI/analytics sloj ne smije mutirati evidence history.

---

# 24A. Akcijska matrica za prvi vertical slice

| Akcija | Actor | Preduvjet | Rezultat | Audit / odbijanje |
| --- | --- | --- | --- | --- |
| PublishAssignment | teacher s Course relationom | aktivno članstvo + valjana konfiguracija | nova AssignmentVersion | audit; unauthorized/config error |
| AcknowledgeAssignment | student na Courseu | prikazana konkretna verzija | WorkPolicyBaseline + READY | audit; wrong version / no membership |
| Start/Edit Work | student vlasnik | baseline potvrđen; Work editable | document revision + local journal | evidence; locked/unauthorized |
| SendVersionForReview | student | workflow dopušta; durable snapshot | frozen Version + SUBMITTED_FOR_REVIEW | audit; target not durable |
| OpenReview | assigned reviewer | relation valjan za verziju | IN_REVIEW | access audit; relation expired |
| CreateRevisionRequest | reviewer | pregledana verzija + anchor | RevisionRequest OPEN | audit; invalid anchor/version |
| Respond/Share | student | request u dopuštenom stanju | response + SHARED_FOR_REVIEW | audit; wrong-state |
| Resolve / Clarify | reviewer | konkretna podijeljena verzija | RESOLVED ili NEEDS_CLARIFICATION | audit; stale version |
| ApproveDraft | reviewer/mentor | workflow traži/dopušta approval | APPROVED_FOR_FINAL za konkretnu verziju | audit; changed target |
| RequestFinalSubmission | student | declaration/policy/workflow guards | SubmissionAttempt + DB `requested_at` | audit; blocked reason |
| CompleteSubmission | system worker | exact/exact_with_gaps + hash match + receipt | immutable Submission + FINAL_SUBMITTED | audit; mismatch/system retry |
| RetryTechnicalFailure | system | isti attempt RETRY_PENDING | RECONSTRUCTING istog attempta | idempotent; target immutable |
| ReopenSubmittedWork | posebno ovlašten actor | eksplicitno pravilo + razlog | nova radna grana/version lineage | stara Submission immutable |
| ArchiveWork | system | retention + legal-hold fence | ARCHIVED / deletion actions | audit; hold/generation mismatch |

Ova matrica je normativna za prvi povezani akademski tok. Ako UI ili implementacija nude akciju koja ovdje nema domensko značenje, prvo se mijenja Functional Architecture kroz review.

# 25. Logical commands

Primjeri domain commandova:

- CreateCourse
- CreateAssignment
- PublishAssignmentVersion
- ResolvePolicyForNewAssignmentVersion
- AcknowledgeAssignment
- MigrateWorkPolicyBaselineNarrowingOnly
- StartWork
- CommitDocumentEvents
- CreateVersion
- SendVersionForReview
- AddComment
- CreateSuggestion
- AcceptSuggestion
- CreateRevisionRequest
- ShareRevisionResponseForReview
- AcceptRevisionResponseForRevision
- RequestRevisionClarification
- MarkRevisionRereviewRequired
- ResolveRevisionRequest
- WithdrawRevisionRequest
- RecordConsultation
- ExtendDeadline
- RequestFinalSubmission
- ConfirmDeclaration
- CompleteSubmission
- AddProvenanceAnnotation
- CorrectProvenanceAnnotation
- OpenCase
- GrantCaseAccess
- RevokeCaseAccess
- BuildEvidencePackage
- SealEvidencePackage
- SetLegalHold
- ReleaseLegalHold
- ApplyIntegrationEvent
- ReconcileStaleIntegrationEvent
- ArchiveWork

Svaki command ima authorization, validation, idempotency i audit semantics.

---

# 26. Logical queries

- GetMyWorks
- GetAssignmentStart
- GetCurrentDocument
- GetWorkTimeline
- GetProvenanceForRange
- GetProvenanceSummary
- GetVersions
- CompareVersions
- GetOpenComments
- GetRevisionRequests
- GetEffectivePolicyForWork
- ResolvePolicyPreviewForNewAssignmentVersion
- GetSubmissionReadiness
- GetSubmissionReceipt
- GetCourseDashboard
- GetInstitutionDashboard
- GetAccessAudit
- GetCase
- GetEvidencePackage

Query sloj ne smije mijenjati evidence history.

---

# 27. Value test za svaki novi feature

Novi feature treba imati barem jedan snažan odgovor DA:

### A — dokazivost

Povećava li pouzdanost ili razumljivost procesa nastanka rada?

### B — studentska vrijednost

Pomaže li studentu da stvarno napiše bolji rad ili lakše izvrši akademsku obvezu?

### C — nastavničko vrijeme

Smanjuje li nastavniku vrijeme pregleda, komunikacije ili administracije?

### D — institucionalni rizik

Smanjuje li fakultetu pravni, administrativni, sigurnosni ili governance rizik?

Ako feature nema jak odgovor ni na jedno, nije prioritet.

---

# 28. Prioritet implementacije

## P0 — Trust Core

- Work/Document model
- local journal
- sync
- event model
- evidence
- reconstruction
- submission
- receipts
- recovery

## P1 — Academic Workflow

- Assignment
- AssignmentVersion
- Policy resolution
- versions
- comments
- suggestions
- revision requests
- declaration
- deadline extension

## P2 — Mentorship

- workflow templates
- milestones
- consultation records
- replay
- compare
- defense preparation

## P3 — Institution

- admin relations
- policy management
- retention
- access audit
- evidence/case
- committee access
- system health

## P4 — Integrations

- AAI production
- Merlin/Moodle
- Zotero
- DOCX/PDF
- API/webhooks
- ISVU/Dabar later

---

# 29. Mapiranje na postojeće milestoneove

| Functional Architecture | Existing plan |
| --- | --- |
| Identity / relations | M1, M2 |
| Assignment / versions / policy baseline | M2, M7 |
| Evidence/event substrate | M3 |
| Academic templates / formatting | M4, M5 |
| Collaboration | M6 |
| Submission/reconstruction/declaration | M7 |
| Import/export | M8 |
| AI Assistant | M9, izvan prvog pilota prema D-77 |
| Retention / legal hold | M10 |
| Ops / GO | M11 |
| Pilot execution | M12 |
| Evidence package / committee / defense | M2 model + Val 3 UI, F-02/N-09/D-68 |

Ovaj dokument ne otvara paralelni roadmap. On definira funkcionalne ugovore koje postojeći milestoneovi implementiraju.

---

# 30. Definition of Functional Completeness

Ductura je funkcionalno koherentna kada:

1. svaki ekran iz Product Speca mapira na domenske entitete i command/query ugovore;
2. svaki status koji korisnik vidi pripada točno jednom od četiri modela stanja (Work, Sync, RevisionRequest, SubmissionAttempt);
3. svaki prijelaz ima actor, preduvjete i audit;
4. policy je deterministic i versioned;
5. svaki final submission ima reconstruction + policy + declaration + receipt;
6. collaboration je vezan uz version/document state;
7. provenance može odgovoriti kako je konkretan segment nastao unutar opaženog sustava;
8. offline/multi-device ne može silent-overwriteati rad;
9. case/evidence paket reproducibilno zamrzava relevantno stanje;
10. permissions proizlaze iz odnosa, ne samo uloge;
11. retention i legal hold imaju jasnu interakciju;
12. integracije ne postaju novi source of truth za evidence;
13. recovery put postoji za svaki kritični kvar;
14. product-complete i real-student GO ostaju odvojeni.

---

# 31. Sljedeći engineering koraci

Nakon odobrenja ovog dokumenta:

1. uskladiti postojeći `revision-request.ts` s ovim lifecycleom i dodati izlaz iz `REREVIEW_REQUIRED` te `RESOLVED/WITHDRAWN` kroz zaseban code PR;
2. napraviti executable TypeScript domain types za Work/Assignment/Submission/Policy baseline;
3. napraviti state-machine testove za Work, Sync boundary, RevisionRequest i Submission;
4. napraviti policy-resolution pure function + property testove za novu AssignmentVersion i postojeći Work baseline odvojeno;
5. definirati command/query interface ugovore;
6. definirati provenance DAG interface;
7. definirati retention generation-fence i integration event envelope u backend ugovorima;
8. mapirati postojeće DB migracije na model iz ovog dokumenta;
9. otvoriti samo stvarne delta issuee — ne duplicirati M0–M12 backlog;
10. nakon infrastrukturnih preduvjeta nastaviti postojeći B-7 → F-6/F-7 vertical slice iz PLAN-DEMO/STATE;
11. dodati Functional Architecture provjeru u Product/UX review checklist.

