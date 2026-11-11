/**
 * Interface text, English (D-70): the second table of `messages.hr.ts`, with
 * the same keys, lists and placeholders (`parity.test.ts`) and nothing else.
 *
 * Croatian stays the default interface language (`locale.ts`); this table is
 * only read when a viewer's stored preference names English. The language of
 * a work is a separate value (F-06) and is not read from here.
 *
 * Words from the forbidden vocabulary in docs/PRODUCT.md §5, English column
 * and the D-276 list, never appear here, not even in a negation. The
 * repository scan (`scripts/forbidden-terms/`) reads every string of this
 * folder; `messages.en.test.ts` checks the table as `messages.test.ts` checks
 * the Croatian one.
 */
import type { Messages } from "./messages.hr";

/** The product name on screen (D-124): one value, read through `app.name`. */
const APP_NAME = "Ductura";
const NOTICE_STEP_COUNT = "1 of 2";

const en = {
  app: {
    name: APP_NAME,
    tagline: "How the work was written, with no verdict on authorship.",
  },
  shell: {
    skipToContent: "Skip to content",
    demoBadge: "Demo · invented data",
    // Design v3 shell (#476 6314969336): only static labels and the role the
    // server read; no names or counts the app does not have.
    sideNav: "Side navigation",
    workNav: "Workspace",
    home: `${APP_NAME}, home`,
    space: { teacher: "Teacher space", student: "Student space", admin: "Institution administration" },
    nav: {
      assignments: "My assignments",
      // DAN-309 (B2): the student's own works across courses, /zadaci/radovi.
      works: "My works",
      courses: "My courses",
      newCourse: "New course and assignment",
      fastPath: "Quick path",
      // DAN-492 (N-16): the works a teacher mentors, outside any course.
      mentoredWorks: "Mentored works",
      workspace: "Workspace",
      enroll: "Join a course",
      institution: "Institution overview",
      // DAN-581 (A-02): the institution's teachers and their roles, /ustanova/korisnici.
      users: "Users",
      // DAN-591 (A-03): the institution's courses, teams and groups, /ustanova/kolegiji.
      institutionCourses: "Courses",
      // DAN-590 (A-04): the faculty rule versions, /ustanova/pravila.
      facultyRules: "Faculty rules",
    },
    role: { teacher: "Teacher", student: "Student", admin: "Administrator" },
    demoNote: "No real personal data.",
    signOut: "Sign out",
    openNav: "Open navigation",
    closeNav: "Close navigation",
    theme: "Switch between light and dark theme",
    breadcrumb: "Path",
    homeCrumb: "Home",
  },
  home: {
    openWorkspace: "Open workspace",
    openTeacher: "Open courses",
    // #802 part B: the signed-in home (pocetna.dc.html: greeting, cards).
    title: "Home",
    // Locative of the app name ("u Ducturu").
    welcome: "Welcome to Ductura",
    spaces: "Spaces",
    workTitle: "My work",
    workBody: "Writing and submitting seminar papers and theses.",
    coursesTitle: "My courses",
    coursesBody: "For teachers: courses, assignments and student works.",
    enrollQuestion: "Have a code for a new course?",
    enroll: "Join",
  },
  // FE-H1 (#476): public home page for a visitor without a session. Every
  // entry leads to /prijava; sign-in is AAI@EduHr only (D-09). Live view and
  // replay as decided in D-142..D-144 and D-154; one summary for both roles (PRODUCT §5, 5).
  landing: {
    sectionsNav: "Home page sections",
    howItWorksLink: "How it works",
    forWhomLink: "Who it is for",
    eyebrow: "Writing log · seminar papers and theses",
    title: "The work is visible",
    titleAccent: "as it takes shape.",
    intro: `The student writes, and the teacher follows how the work takes shape and comments next to paragraphs. ${APP_NAME} does not assess authorship or AI use, and before you start you see what the teacher sees and from when.`,
    enter: "Sign in and start",
    aaiOnly: "Sign-in only through AAI@EduHr.",
    previewLabel: "Example workspace: a page of the work and a teacher comment, invented data",
    previewSignature: "DUC · 371.3 · work 07",
    previewTitle: "Urban transport and sustainable mobility",
    previewSection: "1. Introduction",
    previewParagraph1:
      "Cities are changing their traffic rules more and more often to reduce congestion and air pollution. This work follows how such decisions are made at city level.",
    previewParagraph2Start: "The research question is: ",
    previewParagraph2Marked: "how do public policies shape transport choices",
    previewParagraph2End: " in a medium-sized city?",
    previewCommentAuthor: "Teacher's comment",
    previewCommentPlace: "on paragraph 2",
    previewComment: "Good direction. Narrow the question to one city and state the period you are looking at.",
    previewNote: "Invented example",
    forWhomTitle: "Two roles, the same view of the work.",
    forWhomLead: `The summary of how the work was written is the same for the student and the teacher. ${APP_NAME} does not grade the writing process.`,
    studentEyebrow: "For students",
    studentTitle: "Write in peace and know what is visible.",
    studentBody:
      "The assignment, deadline and rules are in one place. Before the first sentence you can read what the teacher sees and from when, and comments arrive next to the paragraph they refer to.",
    studentPoints: {
      notice: "Assignment notice before you start writing",
      comments: "Teacher comments next to paragraphs",
      replay: "The same replay of how the work was written that the teacher sees",
    },
    teacherEyebrow: "For teachers and mentors",
    teacherTitle: "Follow the work as it takes shape.",
    teacherBody:
      "You see the work live while the student writes and can comment while it can still be improved. You can replay how the work was written character by character, for a conversation with the student, not for a grade.",
    teacherPoints: {
      assignment: "Assignment with a deadline and course rules",
      live: "Live view of the work and comments next to paragraphs",
      summary: "Summary of how the work was written at submission, the same as the student's",
    },
    howTitle: "Four steps from assignment to submission.",
    steps: {
      assignmentTitle: "Assignment and notice",
      assignmentBody:
        "The teacher publishes an assignment with a deadline and rules. Before writing, the student sees a notice: what the teacher sees, from when, and what is kept.",
      writingTitle: "Writing",
      writingBody:
        "The student writes in the assignment editor. The teacher and mentor see the work live as it takes shape, and the student knows this before the first sentence.",
      commentsTitle: "Comments",
      commentsBody:
        "The teacher leaves a comment next to a paragraph. The student sees it in the same place and decides how to revise the text.",
      submitTitle: "Submission with receipt and summary",
      submitBody:
        "The student submits the work and gets a submission receipt. The summary of how the work was written is the same in both views and is not a verdict on authorship.",
    },
    // FE-H2a (#476): ten announcements of the full flow. Steps the app does not
    // have yet carry "Uskoro" and stay neutral, never a promise (PRODUCT §5).
    flow: {
      link: "Workflow",
      title: "The whole workflow in ten steps.",
      lead: "From assignment to institution. Steps marked “Coming soon” are in preparation and not yet part of the app.",
      soon: "Coming soon",
      steps: {
        assignment: {
          name: "Assignment",
          title: "The student knows what is expected.",
          body: "The teacher publishes an assignment with a deadline, format, length and course rules. The student sees them in one place before the first sentence.",
        },
        writing: {
          name: "Writing",
          title: "A draft becomes an academic work.",
          body: "The student writes in the assignment editor, with headings and citations. The teacher sees the work live as it takes shape, and the student knows this in advance.",
        },
        sources: {
          name: "References",
          title: "From citation to source.",
          body: "A citation in the text is linked to a source in the reference list, in the style the faculty sets.",
        },
        mentoring: {
          name: "Mentoring",
          title: "A comment on the exact paragraph.",
          body: "The teacher leaves a comment next to the paragraph it refers to. The student sees it in the same place.",
        },
        reply: {
          name: "Reply",
          title: "The student replies to a comment.",
          body: "The reply sits next to the comment, so the conversation about the paragraph stays in one place. The student decides how to revise the text.",
        },
        versionReview: {
          name: "Version review",
          title: "A review tied to a specific version.",
          body: "The teacher marks which version of the work they reviewed, so both know which text was discussed.",
        },
        laterChange: {
          name: "Later change",
          title: "A change after review calls for a new review.",
          body: "When a reviewed paragraph changes later, the teacher sees that they can review it again.",
        },
        submission: {
          name: "Submission",
          title: "The student knows what they are submitting.",
          body: "Before submitting, the student sees exactly what they are submitting, and after submitting they get a receipt. The summary of how the work was written is the same for the student and the teacher.",
        },
        defence: {
          name: "Defence",
          title: "A precisely defined version for the defence.",
          body: "Those taking part in the defence of the work get exactly the submitted version.",
        },
        institution: {
          name: "Institution",
          title: "Framework and roles, without reading the works.",
          body: "The institution sets rules and roles for its courses. It does not read the content of the works.",
        },
      },
    },
    closingTitle: `${APP_NAME} shows how the work was written.`,
    closingAccent: "A person draws the conclusion.",
    footerNote: "A space for academic writing.",
    wow: {
      sidesEyebrow: "Try it",
      sidesTitle: "Write on the left. The mentor sees the same on the right.",
      sidesLead:
        "Trial space: the text stays in this browser and is not sent anywhere. In real work, your mentor sees your work live, with comments next to paragraphs.",
      studentPane: "Student writes",
      mentorPane: "Mentor sees",
      editorLabel: "Student's trial text",
      mentorLabel: "The same text in the mentor's view, read-only",
      placeholder: "Start writing your first sentence…",
      sampleText: "Cities change traffic rules more and more often.",
      sampleComment: "Narrow it to one city and state the period.",
      sampleCommentPlace: "on paragraph 1 · mentor (invented)",
      loading: "Loading the trial space…",
    },
    replay: {
      eyebrow: "Rewind",
      title: "Go back through how a paragraph was written.",
      lead: "The assignment mentor and the student can rewind how the text was written, step by step. This is an invented example; nobody wrote it.",
      empty: "The paragraph is empty at the start.",
      start: "Start",
      during: "During writing",
      end: "Final text",
      play: "Play",
      pause: "Pause",
      sliderLabel: "Rewind step",
      stepOf: "step {step} of {last}",
      note: "Rewind shows the order of changes, not a grade or an assessment. The rhythm of writing says nothing about authorship or effort.",
      // Invented edits, one per step: "+text" appends, "from>>to" replaces (see rewind-frames.ts).
      edits: [
        "+Cities",
        "+ change",
        "+ traffic",
        "+ rules",
        "+ more",
        "+ often.",
        "more often.>>more often, but unevenly.",
        "+ Parking",
        "+ changes",
        "+ the",
        "+ most.",
        "Parking changes the most.>>Parking in the centre changes the most.",
        "Cities>>European cities",
      ],
    },
    access: {
      eyebrow: "Who sees what",
      title: "The same work, clear roles.",
      lead: "See what each role sees and what it does not. The rules are the same for all assignments.",
      tablistLabel: "Role",
      sees: "Sees",
      doesNot: "Does not see",
      note: "The mentor and the assignment teacher are one role. Nobody else can rewind how the work was written.",
      roles: {
        student: {
          name: "Student",
          sees: [
            "The monitoring notice as the first screen of the assignment, before the first sentence.",
            "Exactly what the mentor sees about their work, in the same view.",
            "A rewind of how their own work was written, the same as the mentor has.",
            "Who opened their work and when.",
          ],
          not: [
            "The mentor's private working notes. They can request them through the right of access.",
            "The grade and its reasoning before the mentor publishes them.",
          ],
        },
        mentor: {
          name: "Mentor and assignment teacher",
          sees: [
            "The work live, as it takes shape.",
            "A rewind of how the work was written, character by character.",
            "Comments next to paragraphs and the student's replies.",
          ],
          not: [
            "Any grade or assessment of the student: the view is for following the work and commenting.",
            "The history of intermediate states in the summary, comparison or export. It exists only in the live view and the rewind.",
          ],
        },
        institution: {
          name: "Institution",
          sees: [
            "Rules and roles for its courses, which it sets itself.",
            "Who accessed which work and when.",
          ],
          not: [
            "The content of the works.",
            "The rewind of how the work was written: it is not available to other roles.",
          ],
        },
      },
    },
    faq: {
      eyebrow: "Questions",
      title: "Short answers.",
      items: {
        authorship: {
          q: `Does ${APP_NAME} claim who wrote the work?`,
          a: `No. ${APP_NAME} shows what was observed in the editor and calculates no measures about the student. A person draws the conclusion.`,
        },
        beforeWriting: {
          q: "What does the student know before writing?",
          a: "The first screen of every assignment says what the teacher sees and from when. The student reads this before the first sentence.",
        },
        ai: {
          q: "Does the student have to use AI?",
          a: "No. Nothing in the assignment requires AI from the student, and the assistant is available only if the assignment allows it.",
        },
        signIn: {
          q: "How does a student sign in?",
          a: "Only with their own AAI@EduHr account. There is no other way to sign in.",
        },
        offline: {
          q: "What if the connection drops while writing?",
          a: "The text is saved on this device, and a label shows whether it has reached the server. Work written offline stays marked as such even after syncing.",
        },
        tryOut: {
          q: "Is anything sent from the trial space?",
          a: "No. The text you type stays in this browser and is not sent anywhere.",
        },
      },
    },
  },
  teacher: {
    title: "New course and assignment",
    signedOut: "Sign in with a teacher account.",
    unavailable: "The teacher role check is not available right now. Please try again.",
    signIn: "Sign in",
    backHome: "To home",
    backCourses: "My courses",
    // DAN-310 (M2.4-P01): a further assignment in a course the teacher already has.
    existingCourse: {
      title: "New assignment in the course",
      link: "New assignment in the course",
      missing: "The course is not available to this account.",
      unavailable: "The course cannot be loaded right now. Please try again.",
      codeKept: "The course enrolment code stays the same.",
      studentsNotified: "Students enrolled in the course see the assignment among their assignments.",
    },
    // DAN-310 (M2.4-P02): a new version of a published assignment.
    newVersion: {
      title: "New version of the assignment",
      link: "New version",
      current: "Version {n} is in force.",
      lead: "Changes are published as version {n}. The version now in force stays on record, and students confirm the new version before they continue writing.",
      fixed: "The type of work, the record profile and import stay as in the version in force.",
      purposesHint: "You can only remove a use that the version in force allows, not add a new one.",
      wordsHint: "The range can only be relaxed: lower or remove the minimum, raise or remove the maximum.",
      previewHeading: "What changes",
      before: "Now",
      after: "After publishing",
      empty: "not set",
      noPurposes: "no use",
      consequence: "Publishing creates version {n}. Students enrolled in the course see it in the assignment notice and confirm it before they continue writing. Text already written stays as it is.",
      publish: "Publish version {n}",
      pending: "Publishing…",
      published: "Version {n} is published. Students confirm it before they continue writing.",
      unchanged: "There are no changes from the version in force, so nothing is published.",
      widening: "This word range is stricter than the one in force, so it cannot be published. Lower or remove the minimum, and raise or remove the maximum.",
      reload: "Load the current version",
      missing: "The assignment is not available to this account.",
      unavailable: "The assignment cannot be loaded right now. Please try again.",
      fields: {
        title: "Title",
        instructions: "Instructions for students",
        opensAt: "Opens",
        dueAt: "Deadline",
        aiPurposes: "Allowed uses",
        wordRange: "Word range",
      },
      errors: {
        invalid: "Check the title, opening, deadline and word range. The deadline must be after the opening. Nothing has been published.",
        unauthorized: "The sign-in is not valid. Sign in again; nothing has been published.",
        forbidden: "This account is not allowed to publish a new version of this assignment.",
        conflict: "The assignment has received a newer version in the meantime. Your changes have not been published and stay in the form. Load the current version, then make them again.",
        unavailable: "Publishing the version was not confirmed. Please try again.",
      },
    },
    course: {
      heading: "Course",
      name: "Name",
      year: "Academic year",
      years: { "2026/2027": "2026/2027", "2025/2026": "2025/2026" },
      policy: "Rules for AI use",
      policies: {
        prohibited: "AI help is not allowed",
        partially_allowed: "AI help is partly allowed",
        encouraged: "AI help is encouraged within the course rules",
      },
      submit: "Create course",
      pending: "Creating the course…",
      // create_course returns the existing id for an identical repeat.
      created: "The course is ready.",
      // FE-D10: only a code the route returned is shown (#576); never an invented one.
      code: "Enrolment code",
      nameMissing: "Enter the course name.",
      errors: {
        invalid: "Check the name, academic year and course rules.",
        unauthorized: "The sign-in is not valid. Sign in again.",
        forbidden: "This account is not allowed to create courses.",
        conflict: "A course with that name already exists with different rules.",
        unavailable: "Creating the course was not confirmed. Please try again.",
      },
    },
    // DAN-36 (#576 6362017778): the teacher picks the deadline; there is no default.
    enrollmentCode: {
      validUntil: "Code valid until",
      expiryHelp: "Required. Choose the date and time until which students can enrol in the course with this code, at most one year ahead.",
      selected: "Selected:",
      pending: "Issuing the code…",
      retry: "Issue the code again",
      replace: "Issue a new code",
      shownOnce: "The code is shown only now. Write it down and give it to students. A new code replaces this one.",
      courseKept: "The course exists. Trying again only issues a code; it does not create a new course.",
      errors: {
        missing: "Choose until when the code is valid.",
        invalid: "Choose a date and time that exist, in the future and at most one year ahead.",
        unauthorized: "The code was not issued. The sign-in is not valid. Sign in again.",
        forbidden: "This account is not allowed to issue a code for this course.",
        unavailable: "It is not confirmed whether the code was issued. Trying again issues a new code that replaces any previous one.",
      },
    },
    assignment: {
      heading: "Assignment",
      title: "Title",
      workType: "Type of work",
      workTypes: {
        seminar_paper: "Seminar paper",
        bachelor_thesis: "Bachelor's thesis",
        master_thesis: "Master's thesis",
        essay: "Essay",
        // Accepted by the server (create-assignment.ts), not offered by the form yet.
        short_paper: "Short paper",
        specialist_thesis: "Specialist thesis",
        doctoral_thesis: "Doctoral thesis",
      },
      opensAt: "Opens",
      dueAt: "Deadline",
      instructions: "Instructions for students",
      wordMin: "Minimum number of words (optional)",
      wordMax: "Maximum number of words (optional)",
      wordRangeHint: "Enter a whole number from 1 to 1,000,000. The minimum must not be greater than the maximum.",
      publish: "Publish assignment",
      pending: "Publishing…",
      published: "Published",
      publishedNotice: "The assignment is published. Students with the code see the notice before the first sentence.",
      needCourse: "Create a course first.",
      studentsNotified: "Students get the notice when they enrol in the course.",
      newVersion: "Changing the assignment after publishing creates a new version; students confirm it again.",
      errors: {
        invalid: "Check the title, type of work, opening, deadline and word range. The deadline must be after the opening.",
        unauthorized: "The sign-in is not valid. Sign in again.",
        forbidden: "This account is not allowed to publish assignments in this course.",
        conflict: "An assignment with the same key already exists with different details. Check the assignment and publish again.",
        unavailable: "Publishing the assignment was not confirmed. Please try again.",
      },
    },
    // Verbatim text of the FPZG Smjernice, čl. 8 (owner decision on #87,
    // 6236852400; text from #314, 6236916582). Words and punctuation are not
    // edited, except the two places marked below. The keys of `purposes` are
    // the database list (D-80).
    tools: {
      heading: "Use of tools (FPZG Guidelines, Article 8)",
      narrowOnly: "You can only narrow the list.",
      allowed: "Allowed in this assignment",
      banned: "Not allowed",
      bannedNone: "All uses from the list above are allowed in this assignment.",
      courseProhibits: "The course rules do not allow AI help, so neither does this assignment.",
      source:
        "Source: Guidelines for the use of generative artificial intelligence in teaching and in preparing student work, FPZG Faculty Council, 21 May 2026, Article 8. The third indent of paragraph 1 is shortened and paragraph 3 is not shown; the full text is in the Guidelines.",
      purposes: {
        formatting: "use for formatting one's own written work;",
        proofreading: "use for proofreading and language checking of one's own written work;",
        // Not verbatim: the article's wording uses a word from the forbidden
        // vocabulary (PRODUCT §5), as does stavak 3. Question on #314.
        literature_search: "finding scholarly and professional literature (paragraph 1, third indent)",
        transcription:
          "transcribing interviews and audio or video recordings, with a mandatory check of the accuracy of the transcribed content and care for the protection of personal data;",
        translation:
          "translating from foreign languages into Croatian or from Croatian into a foreign language, with a mandatory check of meaning and terminology.",
      },
      conditions: {
        own: "2) In all the cases listed, the final content must come from the student's individual reflection and work.",
      },
      alwaysBannedHead: "4) Inappropriate use of GenAI is considered to be:",
      alwaysBanned: {
        texts: "generating parts or the whole of oral presentations, short papers, essays, seminar papers, bachelor's or master's theses;",
        media:
          "generating parts or the whole of media content, unless the teacher has expressly set this as part of the student assignment, and only in the form in which it was explicitly set;",
        data:
          "generating and coding qualitative and quantitative data, unless the teacher has expressly set this as part of the student assignment, and only in the form in which it was explicitly set;",
        graded:
          "using GenAI to master and solve graded problem-solving and analytical tasks, unless the teacher has expressly set this as part of the student assignment, and only in the form in which it was explicitly set;",
        arguments: "taking over arguments, interpretations or conclusions;",
        asOwn:
          "presenting content produced with GenAI in written work, oral presentations and other forms of work, and putting it forward as one's own work;",
        unverified:
          "using unverified sources, quotations or empirical data that were produced with GenAI and are partly or entirely made up;",
        exams:
          "using GenAI during exams or knowledge checks unless this is expressly allowed, and only in the form in which it is explicitly allowed;",
        notes: "writing summaries and one's own notes without reading the works the notes are based on;",
        ideas: "generating ideas for student work without the student's active participation in developing the argument.",
      },
    },
    preview: {
      heading: "What the student sees: the notice before the first sentence",
      step: `Step ${NOTICE_STEP_COUNT}`,
      untitled: "Assignment title",
      opensFrom: "open from",
      due: "deadline",
      rest: "The rest of the notice (what is recorded, what the teacher sees, retention) is the same for all assignments.",
    },
  },
  // Screen 11, the teacher's fast path (F-11, D-80 point 2). Lines are facts in words (PRODUCT §5 rule 2).
  // Z3 (A), #476 6289158306: the teacher's entry at /nastavnik. The order is
  // the route's (year, name; assignments by due time) and nothing reorders it.
  // DAN-313 (A-01): counts only, for the administrator's own institution;
  // never a person, a course name or an activity time.
  institutionOverview: {
    title: "Institution overview",
    lead: "The figures apply only to your institution and are calculated when the page opens. Individual people and courses are not shown here.",
    unnamed: "Institution name not entered",
    countsLabel: "Institution figures",
    counts: {
      confirmedTeachers: {
        label: "Confirmed teachers",
        note: "The role is confirmed and has not been revoked.",
      },
      teacherCandidates: {
        label: "Waiting for role confirmation",
        note: "The last sign-in through AAI@EduHr gave teacher rights, and you have not yet confirmed the role.",
      },
      teachersWithoutAffiliation: {
        label: "Teachers without rights at the last sign-in",
        note: "The role stays confirmed; only the last sign-in did not give teacher rights.",
      },
      courses: { label: "Courses", note: "All courses of the institution." },
      students: { label: "Students", note: "Enrolled in at least one course, each person counted once." },
    },
    unavailable: "The institution overview is not available right now. Please try again.",
    retry: "Try again",
  },
  // DAN-581 (A-02, docs/design/ductura/m2-reference): the administrator
  // confirms and revokes the teacher role. "Za pregled" is D-200 P7: a lost
  // right at sign-in does not revoke the role. Names stay in the nominative
  // on their own line ("Osoba"), since a name cannot be declined reliably.
  teacherRoles: {
    title: "Users and roles",
    lead: "Teachers at your institution and people waiting for role confirmation. You confirm and revoke the teacher role; signing in through AAI@EduHr only lets a person wait on the list for you.",
    person: "Person",
    // A person whose name the identity provider has not given (identity.person_name has no row).
    unnamed: "Name not entered",
    pending: {
      heading: "Waiting for role confirmation",
      note: "Their last sign-in through AAI@EduHr gave them teacher rights. The role starts only when you confirm it.",
      empty: "Nobody is waiting for role confirmation.",
      emptyNote: "A person appears here after signing in through AAI@EduHr with teacher rights at this institution.",
      revokedOn: "role revoked",
    },
    confirmed: {
      heading: "Confirmed teachers",
      empty: "There are no confirmed teachers at the institution yet.",
      confirmedOn: "Confirmed",
    },
    review: {
      mark: "For review",
      note: "The last sign-in did not give teacher rights. The role has not been revoked and stays until you decide.",
    },
    confirmAction: "Confirm role",
    revokeAction: "Revoke role",
    cancel: "Cancel",
    close: "Close",
    check: "Check status",
    confirmDialog: {
      label: "Role confirmation",
      title: "Confirm the teacher role?",
      points: [
        "They will be able to create courses and assignments at this institution.",
        "You can revoke the role later.",
        "The confirmation is entered in the audit trail, with you as the person who carried it out.",
      ],
    },
    revokeDialog: {
      label: "Role revocation",
      title: "Revoke the teacher role?",
      points: [
        "From the next request they can no longer work as a teacher at this institution.",
        "Courses and assignments stay. If they lead a course, they stay entered as its lead until a teacher of that course replaces them.",
        "If a later sign-in gives them teacher rights, they will wait for your confirmation again.",
        "The revocation is entered in the audit trail, with you as the person who carried it out.",
      ],
    },
    // One line per outcome of teacher-role-action.ts; "unknown" never claims either way.
    outcome: {
      confirmed: "The teacher role is confirmed. The person is now among the confirmed teachers.",
      revoked: "The teacher role is revoked.",
      notCandidate: "Confirmation is not possible. This person is no longer waiting for confirmation at your institution. The list has been refreshed.",
      notConfirmed: "Revocation is not needed. This person no longer has a confirmed role at your institution. The list has been refreshed.",
      unknownConfirm: "The outcome is not known. The connection to the server broke before the reply, so it is not certain whether the role was confirmed. Check the status before you try again.",
      unknownRevoke: "The outcome is not known. The connection to the server broke before the reply, so it is not certain whether the role was revoked. Check the status before you try again.",
      ended: "The action was not carried out. Your sign-in has expired or you no longer have access to this page. The page has been refreshed.",
      invalid: "The action was not carried out. Refresh the page and try again.",
    },
    unavailable: "The list of users is not available right now. Please try again.",
    retry: "Try again",
  },
  teacherCourses: {
    title: "My courses",
    lead: "Courses you teach and their assignments. Order: academic year, then name; assignments by deadline.",
    newCourse: "New course and assignment",
    empty: "You have no courses that you teach.",
    emptyLead: "Create a course and publish the first assignment.",
    noAssignments: "No assignments yet.",
    unavailable: "Courses are not available right now. Please try again.",
    retry: "Try again",
    due: "deadline",
    at: "at",
    students: { one: "student", few: "students", many: "students" },
    countNote: "The number of students is for overview only; nothing is ordered by it.",
    // F2 (#711): links to the students' works; numbered, since names arrive with B-11.
    worksLabel: "Student works",
    work: "Work",
    noWorks: "No student has opened a work yet.",
    worksUnavailable: "Works are not available right now. Please try again.",
    // DAN-332 PR 4 (#826 c.6427128741): the state of each work's submission, as text only, never a colour (D-128).
    submission: {
      onTime: "Submitted",
      afterDeadline: "Submitted after the deadline",
      none: "Not submitted",
    },
    accommodation: "Approved accommodation",
    accommodationsUnavailable: "Approved accommodation marks are not available right now. Please try again.",
  },
  // DAN-492 (M2.6-P02, N-16), design pregled-radova-v2: only what the read gives (D-202).
  mentoredWorks: {
    title: "Works you mentor",
    lead: "Bachelor's, master's and other theses you mentor. This view only reads; it changes nothing.",
    listTitle: "Works · alphabetical",
    orderNote: "The list cannot be ordered by numbers.",
    empty: "You have no open mentorships.",
    unavailable: "Works are not available right now. Please try again.",
    retry: "Try again",
    unnamed: "Name not available",
    open: "Open work",
    // The state as text only, never a colour (D-128).
    state: {
      not_started: "The student has not started the work yet.",
      in_progress: "Being written",
      submitted: "Submitted",
    },
  },
  fastPath: {
    title: "Fast path",
    intro: "The works for one assignment, one after another. This view only reads; it changes nothing.",
    loading: "Loading works…",
    unavailable: "Works are not available right now. Please try again.",
    // F-11 (#757, contract c.6397637802 §3; owner c.6397679688).
    pickAssignment: "Choose an assignment in your courses.",
    empty: "There are no works to show for this assignment.",
    refresh: "Status saved on the server. Refreshes at most every 5 minutes.",
    stale: "The status has not been refreshed. The last loaded status is shown; the next attempt is in at most 5 minutes.",
    // #757 D1, za potvrdu: a student whose account has no name; never a number or an address.
    unnamed: "Name not available",
    studentsLabel: "Students",
    studentsTitle: "Students · by surname",
    // #732 item 18, design pregled-radova-v2 (D-80): the list has no order by numbers.
    orderNote: "The list cannot be ordered by numbers.",
    work: {
      notice_pending: "Notice not yet confirmed",
      writing: "Being written",
      submitted: "Submitted",
    },
    noRecord: "no record",
    noRecordYet: "The student has not confirmed the notice yet. There is no record.",
    at: "at",
    viewLabel: "Work view",
    views: { text: "Text of the work", summary: "Summary of how the work was written" },
    textLabel: "Text of the work, read only",
    lines: {
      lastChange: "Last change",
      pastes: "Pastes without a source",
    },
    none: "none",
    openWork: "Open work",
    soon: "soon",
  },
  workspace: {
    title: "Workspace",
    viewModes: "View",
    // #711 F1, za potvrdu: the name of the top bar region (course, assignment, view, submission).
    barLabel: "Assignment and view",
    modeWriting: "Writing",
    modeTeacherView: "As the teacher sees it",
    // #732 item 7 (owner 6397193676): the line above the teacher's view, and why the switch is off.
    teacherViewLead: "This is how your teacher sees your work: the latest text your browser sent, the comments and the process summary. You cannot write here.",
    teacherViewOff: "only with an assignment",
    // F-10: a link to the submission screen, not the act of submitting (#653 contract 6385776645).
    submitLink: "Submission",
    soon: "soon",
    sheetTheme: "Sheet theme",
    sheetThemeLight: "White sheet",
    sheetThemeDark: "Dark sheet",
    structure: "Structure",
    structureLabel: "Structure of the work",
    structureEmpty: "Headings will appear here.",
    tables: "List of tables",
    tablesEmpty: "No tables.",
    footnotes: "Footnotes",
    footnotesEmpty: "No footnotes.",
    progress: "Progress",
    sidePanel: "Instructions, references and comments",
    panelTabs: "Side panel",
    tabSources: "References",
    tabInstructions: "Instructions",
    tabComments: "Comments",
    sourcesEmpty: "The references of the work are shown here.",
    // DAN-343 (contract on #866): the "Literatura" tab, design editor-v11 "Brzi izvor".
    sources: {
      add: "+ Source",
      formTitle: "New source",
      type: "Source type",
      book: "Book",
      article: "Journal article",
      family: "Author's surname",
      given: "Author's first name",
      secondAuthor: "Second author (optional)",
      family2: "Second author's surname",
      given2: "Second author's first name",
      year: "Year",
      title: "Title",
      place: "Place of publication",
      publisher: "Publisher",
      journal: "Journal",
      volume: "Volume",
      issue: "Issue",
      pages: "Pages",
      citePage: "Cited page (optional)",
      preview: "This is how it will be entered",
      addAndCite: "Add and cite",
      addOnly: "Add to References only",
      cancel: "Cancel",
      cite: "Cite",
      listTitle: "Sources added in this work",
      empty: "Add a source; the citation and the reference list entry are written in FPZG style.",
      required: "Enter: {field}.",
      yearInvalid: "The year has four digits.",
      tooLong: "{field} has at most {n} characters.",
      pageTooLong: "The cited page has at most {n} characters.",
      unstorable: "{field} contains a character the sheet does not accept; enter the field again.",
      pageUnstorable: "The cited page contains a character the sheet does not accept; enter it again.",
      readOnly: "The sheet is read-only; sources cannot be added.",
    },
    instructionsEmpty: "The assignment instructions are shown here.",
    commentsEmpty: "The teacher's comments are shown here.",
    // FE-D9 (06c): "Upute" and "Rad" of the right panel, design editor-v11 §5.1.
    tabWork: "Work",
    workEmpty: "The stages and attachments of the work are shown here.",
    panelLoading: "Loading…",
    panelUnavailable: "The content cannot be loaded right now. Refresh the page.",
    upute: {
      task: "Assignment",
      due: "Deadline: {date} at {time}",
      toolsAllowed: "Permitted use of tools (FPZG Guidelines, Art. 8)",
      toolsNone: "The use of generative artificial intelligence tools is not permitted in this assignment.",
      checks: "Format check · FPZG",
      checksNote: "The check is there to help; nothing blocks submission.",
      // M2.10-P02 (DAN-386): the language of the student's work, not of the interface.
      workLanguage: "Language of the work: {language}",
      workLanguages: { hr: "Croatian", en: "English" },
      // M4 (DAN-506): S-11 "Upute i provjera oblika", states 1a-6 of the
      // approved reference (docs/design/ductura/m4-reference). Not rendered yet.
      shape: {
        title: "Instructions and format check",
        loading: "Loading the rules for this type of work.",
        loadFailed: "The rules cannot be loaded right now. You can still write and submit your work.",
        retry: "Try again",
        disabled: "The format check is not switched on at this institution right now. Submission is not restricted because of this.",
        disabledCause: "Only the administrator can see the cause, on the Faculty rules screen.",
        checkedSummary: "Rules checked: {count}, package version {version} · checked at {time}",
        findingsHeading: "Deviations from the rules",
        goTo: "Go to: {place}",
        source: "Source: {source}",
        notChecked: "not checked",
        staleHeader: "Checked at {time}, package {version}",
        staleNote: "The document has changed since the check. Earlier findings stay visible until you check again.",
        staleLabel: "Out of date, the document has changed",
        recheck: "Check again",
        newerPackage: "Package version {newer} is available. This work still uses version {version}.",
        unavailable: "The format check is not available for this type of work.",
        officialRules: "Read the rules in the official document:",
        partialCovered: "For this type of work, the package covers these rules:",
        partialOthers: "Read the other rules in the official document:",
        typeUnknown: "The type of work has not been set yet, so it is not known which rules apply.",
        scopeHeading: "Length: {min} to {max} words",
        scopeNarrowed: "The teacher has narrowed this within the package range of {min} to {max}.",
        scopeNow: "In the work now:",
        scopeWords: "{count} words",
        scopeCounting: "Words in the body of the work are counted, without the abstract, reference list and appendices.",
        informative: "For information only. Does not affect submission.",
      },
    },
    rad: {
      stages: "Stages",
      stagesEmpty: "The mentor has not set any stages yet.",
      stageState: {
        notStarted: "not started",
        inProgress: "in progress",
        submitted: "with the mentor",
        approved: "approved",
        returned: "returned with a note",
      },
      mentorNote: "Mentor: {note}",
      attachments: "With the work",
      aiStatement: "Statement on AI use",
      package: "Submission package",
    },
    documentUntitled: "Untitled",
    documentLabel: "Text of the work",
    documentNotEditable: "Writing here is not possible yet.",
    // #711 F1 (contract 6391402093 §3, §5, §6): /rad with and without an assignment.
    freeNote: "This text is not linked to an assignment and is not submitted. You open an assignment from its notice.",
    unavailable: "This assignment is not available to this account.",
    // DAN-330: the work starts only on the student's click.
    startWork: "Start the work",
    notStarted: "The work has not been started yet.",
    openLoading: "Opening the work…",
    openNotYet: "The assignment opens {time}.",
    openOffline: "A connection is needed to open the work for the first time.",
    openError: "The work cannot be opened right now.",
    openRetry: "Try again",
    openNotAccepting: "The assignment notice has changed, or the assignment is not accepting work right now.",
    openNoticeLink: "Open the assignment notice",
    openReload: "This version of the page can no longer open the work. Reload it.",
    openReloadButton: "Reload",
    lateNote: "The assignment deadline has passed. You can keep writing, and the submission will be marked as submitted after the deadline.",
    // #711 F1b (contract §4): the earlier draft of this device, offered only to read and copy.
    earlierDraftSummary: "This device keeps an earlier text of yours that is not in this work.",
    // Owner (#711, O3 and amendment c): since 3d-2c2b a paste is an evidence step of the work, so the sentence that says so is back.
    earlierDraftExplain: "The text stays where it is and is not deleted. If you want it in this work, copy it and paste it in; the record of the work then logs that as a paste.",
    earlierDraftCopy: "Copy text",
    // Owner accepted (#711 c.6396392080, b): the contract text "Kopirano u međuspremnik." fails the stem list of messages.test.ts (kopiran).
    earlierDraftCopied: "The text is on the clipboard.",
    // Owner accepted (#711 c.6396392080, a): the contract text "Tekst nije moguće kopirati." is a forbidden term (kopir-, PRODUCT §5).
    earlierDraftCopyFailed: "The text cannot be placed on the clipboard. Export it as a file.",
    earlierDraftOpen: "Open the earlier text",
    status: "Status of the work",
    // FE-D6 (design editor-v11): the status bar.
    statusLoading: "Loading the work…",
    statusNoJournal: "Nothing is stored here.",
    selectedWords: "{words} selected",
    wordMinimum: "at least {words}",
    wordMaximum: "at most {words}",
    pagesApprox: "≈ {pages} pp.",
  },
  editor: {
    placeholder: "Start writing…",
    // 3d-2c2b, owner approved 25 Oct (contract #476 c.6391714810 §3): the
    // server's work differs (CONFLICT, RECOVERY_REQUIRED).
    evidenceConflict:
      "The work on the server differs from the text on this device. The text stays on the device and nothing is sent until you decide how to continue.",
    // 3d-2c2b, owner approved 25 Oct (#87 c.6397773534): a send refused for
    // good. The contract's "spremljen na ovom uređaju" fails the PRODUCT §5
    // scan, so "ovom" is dropped.
    sendRefused: "The text is saved on the device, but the server did not receive it. Reload the page.",
    sendStopped:
      "Sending to the server has stopped. The server does not take new changes. Export the text and contact support.",
    sendStoppedSaved: "The text is saved on the device.",
    // 3d-2c2b, owner approved 25 Oct: the package was closed by the submission (DAN-289 A1).
    submittedReadOnly:
      "The work has been submitted, so you can no longer write here. Changes made after submission are not in the submitted work and stay only on this device.",
    blockedHint: "This tab stores nothing while the other one is open. Once you close it, the text loads here again.",
    failureQuota: "There is not enough space on the device, so changes are no longer being stored. Export the text so you do not lose it.",
    failureUnavailable: "Storing on this device is not available. Export the text so you do not lose it.",
    failureLimit: "The local record has reached its limit, so changes are no longer being stored. Export the text so you do not lose it.",
    failureStale: "The document has since been changed elsewhere, so this tab no longer stores changes. Export the text, then reload the page.",
    failureUnknown: "Storing did not succeed. Export the text so you do not lose it.",
    failureInvalid: "This text cannot be stored. Export it so you do not lose it.",
    recovery: "The local record cannot be read reliably. It stays untouched, and this tab stores nothing.",
    exportText: "Export text",
  },
  // F-8 (DAN-211): the browser reports no network. Says nothing about the
  // server; the save chip alone tells where the text is.
  network: {
    offline: "No network",
    offlineSaving: "No network. The text is still being saved on this device.",
    offlineNotSaving: "No network.",
  },
  toolbar: {
    label: "Text formatting",
    paragraph: "Paragraph",
    bulletItem: "List",
    quote: "Block quote",
    heading1: "Heading 1",
    heading2: "Heading 2",
    heading3: "Heading 3",
    bold: "Bold",
    italic: "Italic",
    undo: "Undo",
    redo: "Redo",
    // FE-D5, editor-v11: tools that do not fit, and the sheet theme.
    more: "More",
    moreMenu: "More tools",
    view: "View",
    viewMenu: "View",
    sheet: "Sheet",
  },
  outline: {
    label: "Headings in the work",
    untitledHeading: "Heading without text",
  },
  // F-9 step 1: the teacher's comments next to a paragraph (B-10, BACKEND 4.11).
  comments: {
    title: "Comments",
    loading: "Loading comments…",
    empty: "No comments.",
    note: "Comments are kept apart from the text of the work and do not count towards the word count.",
    notAvailable: "Comments are not available for this work.",
    unavailable: "Comments cannot be loaded right now.",
    signedOut: "Your sign-in has expired. Sign in again to see the comments.",
    refresh: "Refresh comments",
    number: "Comment {n}",
    teacher: "Teacher",
    student: "Student",
    own: "You",
    state: { open: "open", answered: "answered", resolved: "resolved" },
    showInText: "Show in text",
    notPlaced: "The place in the text cannot be found reliably. The comment stays here.",
    replyLabel: "Reply",
    replyPlaceholder: "Reply…",
    reply: "Reply",
    replying: "Sending…",
    resolvedNote: "The teacher has marked the comment as resolved.",
    replyErrors: {
      signedOut: "Your sign-in has expired. Sign in again.",
      forbidden: "This account cannot reply to this comment.",
      conflict: "The comment has since been marked as resolved.",
      invalid: "The reply was not accepted. Write between 1 and 2000 characters.",
      unavailable: "The reply was not sent. Try again.",
    },
  },
  revisions: {
    title: "Revision requests",
    loading: "Loading revision requests…",
    empty: "No revision requests.",
    notAvailable: "Revision requests are not available for this work.",
    unavailable: "Revision requests cannot be loaded right now.",
    retry: "Try again",
    refresh: "Refresh revision requests",
    signedOut: "Your sign-in has expired. Sign in again to see the revision requests.",
    number: "Revision request {n}",
    teacher: "Assignment teacher",
    student: "Student",
    own: "You",
    state: {
      open: "Open",
      done: "Student says it is done",
      declined: "Student does not agree",
      accepted: "Accepted",
      reopened: "Reopened",
      withdrawn: "Withdrawn",
    },
    acceptedMeta: "Accepted {date}. The request is closed.",
    withdrawnMeta: "Withdrawn {date}. The request is closed.",
    explanationLabel: "Explanation",
    explanationHint: "Write what you changed or why you do not agree, up to 2000 characters.",
    done: "Say it is done",
    declined: "I do not agree, with a reason",
    sending: "Sending…",
    sent: "The answer was sent.",
    submittedNote: "The work has been submitted. The request can no longer be answered.",
    // DAN-314: the answer names the server's current revision, which lacks changes still on the device.
    unconfirmedNote:
      "You can answer once the server has received every change to the text. If an error or a conflict is reported with the text, follow that notice first; the explanation you typed stays here.",
    keptLabel: "Unsent explanation",
    keptHint: "This explanation was not sent because the request can no longer be answered. Copy it if you want to keep it.",
    keptForLabel: "Unsent explanation for revision request {n}",
    keptUnloadedHint: "This explanation was not sent, and the requests cannot be loaded right now. Copy it if you want to keep it.",
    errors: {
      signedOut: "Your sign-in has expired. Sign in again.",
      forbidden: "This account cannot answer this request.",
      conflict: "The request has changed in the meantime. Its current state is shown.",
      invalid: "The answer was not accepted. Write between 1 and 2000 characters.",
      unavailable: "The answer was not sent. Try again.",
      unconfirmed: "The answer was not sent because the server has not yet received every change to the text.",
    },
  },
  // DAN-86 step 2b: the teacher's live view of a work (D-142, BACKEND 4.12).
  // The connection line is about this page's own requests, never the student.
  liveView: {
    context: "Live work",
    documentLabel: "Text of the work",
    sidePanel: "Comments and limits of the record",
    loading: "Loading the work…",
    empty: "The student has not sent any text yet.",
    note: "This is the latest text the student's browser sent. It is not the record of the work, and it may lag or stall.",
    // DAN-332 (#826 PR 3): the route sent the bytes of the submitted revision.
    // These two replace the connection line and the note beside that text.
    submitted: "Submitted work",
    submittedNote: "This is the version of the work the student submitted. This version no longer changes.",
    signIn: "Sign in",
    signInFirst: "Sign in to see the work.",
    invalid: "This link does not lead to a work.",
    connection: {
      loading: "Connecting…",
      live: "Connection is working",
      retrying: "The connection was interrupted. The last text received is shown. Reconnecting…",
      paused: "The view is paused while the tab is in the background.",
      signedOut: "The sign-in has ended.",
      notFound: "This work is not available to this account.",
    },
  },
  // DAN-86 step 2c: the teacher's comment on a marked passage of the live view
  // (design pregled-radova-v2 "Novi komentar"; B-10, BACKEND 4.11).
  // F-10 PR4: the state line of the summary card on the teacher's view of a
  // work. The summary's own text is `summary`, the same for every reader.
  summaryCard: {
    loading: "Loading the summary…",
    signedOut: "Your sign-in has expired. Sign in again to see the summary.",
    notFound: "The summary of this work is not available to this account.",
    unavailable: "The summary is not available right now. Try again.",
    refresh: "Refresh summary",
  },
  // F-10 (#476 contract 6384297464): the student's submission, Ductura screen 4.
  submission: {
    title: "Submitting the work",
    invalid: "This link does not lead to an assignment.",
    signedOut: "Sign in to submit your work.",
    signIn: "Sign in",
    backToWork: "Back to the work",
    notStarted: "The work has not been started yet. Start it in the workspace.",
    steps: { check: "1 Record check", submit: "2 Submission", receipt: "3 Receipt" },
    loading: "Loading the text from the server…",
    textTitle: "This is the text you are submitting.",
    textLabel: "Text being submitted",
    serverNote: "The text submitted is the one saved on the server. Changes that have not yet reached the server are not in the submission.",
    noEvidence: "There is no text of this work on the server yet. Submission is not possible until the text reaches the server.",
    unreadable: "The text from the server cannot be displayed. Submission is not possible from this page.",
    reload: "Reload",
    submit: "Submit the work",
    sending: "Submitting…",
    offline: "Submitting needs a connection to the server.",
    receiptTitle: "Submission receipt",
    receiptLead: "The server recorded the submission and issued this receipt.",
    receiptNote: "The browser does not check the signature of this receipt.",
    requestedAt: "Submission time (server clock)",
    dueAt: "Deadline",
    afterDeadline: "Submitted after the deadline.",
    record: "State of the record",
    records: { continuous: "The record is complete", with_gaps: "The record has gaps; see the process summary" },
    textHash: "Fingerprint of the submitted text (SHA-256)",
    revision: "Version of the text on the server",
    outcome: {
      recordMismatch: "Submission is not possible: the text assembled from the record does not match the text on the server.",
      blocked: "Submission is not possible until the server confirms the whole record of this version of the text.",
      staleRevision: "There is a newer version of the text on the server. Reload it before submitting.",
      alreadyRequested: "A submission has already been requested for another version of the text.",
      notOpen: "Submission for this assignment is not open right now.",
      notFound: "The work is not available to this account.",
      signedOut: "Your sign-in has expired. Sign in again.",
      // No receipt came back: the server may have recorded the submission or not (Codex 4367324506).
      unavailable: "The receipt did not arrive, so the outcome of the submission is not known. Try again.",
    },
    openUnavailable: "The work cannot be loaded from the server right now. Try again.",
    device: {
      checking: "Checking whether this device holds changes the server does not have yet…",
      held: "This device holds changes to this work that the server does not have yet. The work cannot be submitted until they reach the server. Go back to the work and check its save state.",
      unknown: "It cannot be checked whether this device holds changes the server does not have yet. The work cannot be submitted until this is checked. Try again.",
      recheck: "Check again",
    },
  },
  teacherComments: {
    hint: "Select text in the work to comment on it.",
    empty: "No comments. Select text in the work.",
    newTitle: "New comment",
    bodyLabel: "Comment text",
    publish: "Publish",
    publishing: "Publishing…",
    cancel: "Cancel",
    resolve: "Mark as resolved",
    reopen: "Reopen",
    errors: {
      signedOut: "Your sign-in has expired. Sign in again.",
      forbidden: "This account cannot comment on this work.",
      invalid: "The comment was not accepted. Write between 1 and 2000 characters.",
      unavailable: "The comment was not published. Try again.",
    },
  },
  // K-3 text (PLAN-DEMO point 8, D-80 point 3; owner on #87, 6266445027 point 3):
  // the limits of the record, with the two invented histories of the demo.
  recordLimits: {
    title: "What the record cannot show",
    lead: "The record shows how text entered the work in Ductura: typed, pasted or imported. It does not show who came up with the text or where it was written before it entered Ductura.",
    exampleTitle: "Two invented histories",
    exampleA: "Student A wrote their text outside Ductura and imported it all at once. The record shows one import.",
    exampleB: "Student B gradually typed in a text that another person wrote. The record shows gradual writing in Ductura.",
    conclusion: "The record does not show which of these two texts the student wrote themselves. That is why Ductura does not assess authorship: the record makes it easier to talk about the work, and a person draws the conclusion.",
  },
  // F-7 (#336): the S3 notice before the first sentence. What is recorded
  // follows D-142, D-143 and D-154 (live view, per-change time, replay for the
  // mentor, i.e. the teacher of the assignment, and the same replay for the student)
  // and PRODUCT §5 rules 4 and 7; D-24 and D-81 for the 30-second steps.
  // AssignmentNotice renders recorded, notRecorded and teacher in key order.
  // Live view and replay are not built yet, so the notice says what will happen
  // in this assignment. D-63 as corrected on 31. 10. 2026. (#87 c.6544361788,
  // PRODUCT §5 rule 4 exception): the replay neither skips nor marks pauses.
  // The notice names the P-01 sessions as the one measure taken from time.
  // recorded.live also names the input mark the mentor sees (D-54, D-127,
  // src/editor/source.ts).
  student: {
    title: "Assignment",
    // DAN-344 (Archivum S03): the way back from the notice to /zadaci, verbatim from the package.
    backToAssignments: "My courses and assignments",
    // #711 contract 6404612273: the student's own courses and assignments.
    assignments: {
      title: "My assignments",
      heading: "My assignments",
      signedOut: "Sign in to see your assignments.",
      unavailable: "The list is not available right now.",
      empty: "You are not enrolled in any course yet.",
      enroll: "Enrol in a course with a code",
      noAssignments: "There is no assignment in this course yet.",
      due: "Deadline {time}",
      noticeFirst: "Read the notice first",
    },
    // DAN-309 (M2.3-P02, B2): "Moji radovi" on /zadaci/radovi. Each state is
    // told only from what the server read returned; nothing about the text.
    works: {
      title: "My works",
      lede: "Your works in all courses and their status.",
      search: "Search by title or course",
      year: "Academic year",
      allYears: "All years",
      apply: "Show",
      reset: "Clear selection",
      noMatch: "No work matches the selection.",
      emptyHeading: "You have no works yet.",
      emptyBody: "Works appear here once you enrol in a course with an assignment.",
      enroll: "Enrol in a course with a code",
      list: "List of works",
      due: "Deadline {time}",
      state: {
        newVersion: "New version of the instructions ({version}), not yet confirmed",
        notice: "Instructions not yet confirmed",
        notStarted: "Work not started",
        inProgress: "Work started, not submitted",
        submitted: "Submitted {time}",
        afterDeadline: "Submitted {time}, after the deadline",
      },
      readNotice: "Read the instructions",
      start: "Open assignment",
      open: "Open work",
    },
    // DAN-344: the Archivum S01 texts of /zadaci, verbatim from the owner's
    // package (26. 10. 2026.), in "Vi"; the subtitle without its mentoring
    // half, which this page does not have. Only what the own-assignments read
    // returns: courses, assignment titles, due times and the notice state.
    home: {
      heading: "Your student space",
      lede: "Assignments in your courses.",
      courses: "My courses",
      // S02 subtitle: chosen by the orchestrator (Daniel left it to them, 26. 10. 2026.),
      // not the PNG's, because the student has no course page to open.
      coursesLede: "The courses you are enrolled in and their assignments.",
      courseLabel: "Course",
      due: "Deadline: {time}",
      open: "Open assignment",
      readNotice: "Read the instructions",
      unavailableHeading: "This view is not available right now.",
      unavailableBody: "The data could not be loaded. This does not mean there are no courses or works.",
      // S01_prazna: the first arrival, verbatim from the package's PNG.
      empty: {
        heading: "You have no courses yet.",
        body: "Your courses and their assignments will appear here.",
        codeHeading: "Have a course code?",
        nextHeading: "What comes after enrolling?",
        steps: [
          { title: "Choose an assignment", body: "In each course your teacher gives you assignments." },
          { title: "Read the instructions", body: "Each assignment comes with clear instructions and expectations." },
          { title: "Open your work", body: "When you are ready, you start writing in the editor." },
        ],
      },
    },
    signedOut: "Sign in to see the assignment.",
    signIn: "Sign in",
    enroll: {
      title: "Course enrolment",
      heading: "Enrol in a course",
      signedOut: "Sign in to enrol in a course.",
      label: "Course code",
      hint: "Your teacher gives you the code. Spaces, hyphens and upper or lower case do not matter.",
      submit: "Enrol",
      sending: "Enrolling…",
      opening: "You are enrolled in the course. Opening the assignment notice…",
      errors: {
        malformed: "The code has 8 to 32 letters and digits. Check it and enter it again.",
        refused: "The code does not exist or has expired. Check it with your teacher.",
        tooManyAttempts: "Too many attempts. Try again later.",
        unauthorized: "Your sign-in is not valid. Sign in again.",
        forbidden: "This account cannot enrol in a course.",
        invalid: "The enrolment was not accepted. Reload the page.",
        unavailable: "Enrolment is not possible right now. Try again.",
        offline: "No connection to the server. Check your network and try again.",
      },
      course: {
        none: "You are enrolled in the course, but it has no open assignment yet. When your teacher publishes one, come back to this page.",
        notFound: "This course is not available to this account. Enrol in it with the code your teacher gives you.",
        unavailable: "The course assignments cannot be loaded right now. Try again.",
        retry: "Try again",
        another: "Enrol in another course",
      },
    },
    notFound: "This assignment is not available to this account. Enrol in the course with the code your teacher gives you.",
    unavailable: "The assignment cannot be loaded right now. Try again.",
    // FE-D8 (#476 row 05): the states around the notice; the notice text itself is unchanged.
    loading: "Loading assignment…",
    notOpen: "The assignment opens {time}. You confirm the notice when the assignment opens.",
    pastDue: "The assignment deadline passed {time}.",
    // DAN-344 (Archivum S03-a, #923 c.6545848868): the header verbatim from
    // S03_upute.png; "otvoreno od" is gone (owner, c.6435071376 point 2).
    step: "Before writing",
    courseEyebrow: "Course",
    dueAt: "Deadline: {time}",
    toolsHeading: "Use of tools in this assignment (FPZG Art. 8)",
    noTools: "In this assignment the use of generative artificial intelligence tools is not allowed.",
    recordedHeading: "What is recorded",
    recorded: {
      steps: "Text changes, condensed into segments of at most 30 seconds. Each segment carries one time, rounded to the minute.",
      live: "In this assignment every text change will be recorded, character by character, with its order and time: typing and deleting, pasting, importing, transfer from the AI assistant and the teacher's edits. With each change the input method will also be recorded, so the teacher (mentor) will see a mark when the editor observed neither a key press nor a paste with the input, for example with dictation, some mobile keyboards or assistive tools. The mark says only how the text entered the editor, not who wrote it. This will serve only the live view and replay.",
      chain: "Each storage step gets a digital fingerprint linked to the previous one, so any later change to the record is visible.",
      versions: "Versions, the submission and the notes you add.",
    },
    notRecordedHeading: "What is not recorded",
    notRecorded: {
      inputs: "Which key was pressed and how long it was held. No speed, rhythm or any other measure is calculated from the timing of changes, except sessions: sessions are set by a break longer than the P-01 threshold. The replay will neither skip nor highlight pauses.",
      outside: "Other apps and browser tabs, the camera, microphone and screen.",
      device: "IP address and device data.",
    },
    teacherHeading: "What the teacher (mentor) sees",
    teacher: {
      state: "From the first day they will follow your work live, as it takes shape, including text you may later delete. What you write offline they will see only once the connection returns.",
      // D-154, PRODUCT §5 rules 5 and 7: the student sees the same replay of their own work.
      replay: "The assignment's teacher (mentor) will be able to replay how the work was written, character by character, including deleted text. You will see the same replay of your own work.",
      purpose: "The live view and replay will serve to follow how the work is written and to comment on it, never for grading or ranking.",
      history: "Version history and the process summary, the same one you see.",
      // DAN-235 (D-130, PRODUCT §5 rules 5 and 17): the mentor's working records by kind.
      // Rubric, report draft and grade publication are conditional (D-135, D-136): stated as unavailable, never promised.
      workingNotes: `The mentor (the assignment's teacher) will also be able to keep working records about your work: a last-reviewed mark with its time, private notes and comment templates. They are not a view of the work: you will not see them in the app, but you can request them under your right of access. They contain no measures or conclusions calculated by ${APP_NAME}. They are not part of the summary, the export or the submission, they are deleted together with the work, and they must not affect lateness or the grade. A rubric and a report draft would also be working records, but Ductura does not keep them for now. Publishing grades in Ductura is not available for now either.`,
      noVerdict: `${APP_NAME} does not assess authorship or the use of AI.`,
    },
    // D-05, PRODUCT §6 "Profili evidencije": only for the extended profile.
    teacherExtended: "A comparison of the versions at the end of sessions and of the sent versions.",
    retention: "The record is kept with the work until the end of the period set by the faculty.",
    note: "Before the final submission you can add a note to the work. Notes can only be added.",
    checkbox: "I have read the notice. I know what is recorded and what the teacher (mentor) sees.",
    confirm: "Confirm and open the editor",
    confirming: "Confirming…",
    notConsent: "Confirmation is not consent. Nothing is sent to the server before you confirm.",
    confirmed: "Confirmed {time}. The record starts with the first edit.",
    openEditor: "Open the editor",
    errors: {
      stale: "The teacher has published a new version of the assignment in the meantime. Reload the page and read it.",
      unauthorized: "Your sign-in is not valid. Sign in again.",
      forbidden: "This account cannot confirm the notice for this assignment.",
      invalid: "The confirmation was not accepted. Reload the page.",
      unavailable: "The confirmation was not recorded. Try again.",
    },
  },
  // F-10 (DAN-87): process summary, one text for every reader (PRODUCT §5
  // rule 5, §7). Thresholds stand next to the numbers they decide (rule 12).
  summary: {
    title: "Process summary",
    sameForEveryone: "The student and the teacher see the same summary.",
    timeNote: "Times are in Zagreb time, rounded to the minute.",
    evidenceKind: "Kind of evidence",
    evidenceKinds: { observed: "observed", imported: "imported", declared: "declared" },
    from: "from",
    to: "to",
    at: "at",
    recordState: {
      label: "State of the record",
      complete: "The record is complete",
      has_gaps: "The record has gaps (see the list)",
    },
    sessions: {
      heading: "Writing sessions",
      count: "Number of sessions",
      threshold: "threshold: a new session starts after a pause longer than",
      none: "No sessions recorded.",
    },
    pastes: {
      heading: "Pastes",
      listedThreshold: "threshold: listed separately is a paste larger than",
      size: "Size",
      origins: { not_observed: "source not observed" },
      noneListed: "No pastes larger than the threshold.",
      smaller: "Smaller pastes, count only",
      smallerThreshold: "threshold: at most",
    },
    gaps: {
      heading: "Gaps in the record",
      explanation:
        "A gap in the record is a period between two parts of the record received by the server, for which edits did not reach the server. It says nothing about how the work was written.",
      item: "Gap in the record",
      none: "No gaps in the record.",
    },
    // Forms after a number: nominative, and genitive after "od".
    units: {
      minutesGenitive: { one: "minute", few: "minutes", many: "minutes" },
      characters: { one: "character", few: "characters", many: "characters" },
      charactersGenitive: { one: "character", few: "characters", many: "characters" },
    },
  },
  auth: {
    failedTitle: "Sign-in not completed",
    failedBody: "The sign-in could not be completed. Try again; if it happens again, contact the coordinator at your institution.",
    unavailableBody: "Sign-in through AAI@EduHr is not responding right now. Try again in a few minutes.",
    retry: "Try again",
    home: "To the home page",
    signIn: "Sign in",
    logout: "Sign out",
    loggingOut: "Signing out…",
    logoutUnsaved:
      "This device could not store part of the text, so signing out would lose it. Export the text before signing out.",
    // FE-D7 (D-118): the sign-out dialog. It speaks only of this device: the
    // app sends nothing to the server yet, so it promises no sending (#476).
    logoutTitle: "Sign out",
    logoutConfirm: "Sign out",
    // Unsaved text (#1331): sign-out is still allowed (D-118) but named for what it costs.
    logoutConfirmUnsaved: "Sign out without exporting",
    logoutStay: "Stay",
    logoutPlain: "Signing out closes the session on this device.",
    logoutPending: {
      one: "{n} change exists only on this device. Signing out closes the session.",
      few: "{n} changes exist only on this device. Signing out closes the session.",
      many: "{n} changes exist only on this device. Signing out closes the session.",
    },
    // 3d-2c2b O3, owner approved 25 Oct: steps held after the submission are never sent.
    logoutAfterSubmission: {
      one: "{n} change made after the submission exists only on this device and is not sent. Signing out closes the session.",
      few: "{n} changes made after the submission exist only on this device and are not sent. Signing out closes the session.",
      many: "{n} changes made after the submission exist only on this device and are not sent. Signing out closes the session.",
    },
    logoutKept:
      "The record stays linked to you on this device, and you continue it when you sign in again. Anyone who signs in on this device after you does not see your work.",
    // 3d-2c, P3 and P4 (a): a copy kept outside the work stays on sign-out.
    logoutCopy: {
      one: "This device keeps {n} copy of text that is not in the work.",
      few: "This device keeps {n} copies of text that are not in the work.",
      many: "This device keeps {n} copies of text that are not in the work.",
    },
    logoutCopyKept:
      "Signing out does not delete the copy. It stays linked to you on this device, and you see it again when you sign in.",
    copyTitle: "Copy of the text",
    // F-154 (owner decision 1.3): text written after the submission stays on
    // sign-out (D-118) and goes only on the author's second click.
    afterSubmissionTitle: "Changes after the submission",
    afterSubmissionDiscard: "Delete the changes from this device",
    afterSubmissionDiscardAsk: "Deleted changes cannot be restored. The submitted work stays as it is. Delete them?",
    afterSubmissionDiscardConfirm: "Yes, delete the changes",
    afterSubmissionKeep: "Keep the changes",
    afterSubmissionDiscardFailed: "The changes were not deleted and stay on this device. Try again.",
    copyNewestOnly: "The actions apply to the newest copy.",
    copyRestore: "Return the text to the work",
    copyDiscard: "Discard the copy",
    copyDiscardAsk: "A discarded copy cannot be restored. Discard it?",
    copyDiscardConfirm: "Yes, discard the copy",
    copyKeep: "Keep the copy",
    copyDiscardFailed: "The copy was not discarded and stays on this device. Try again.",
    // #1330, #1444: ended here; nothing calls the server again.
    logoutDevice:
      "Sign-out on this device is complete. The server is not responding right now, so the sign-in there ends at the next sign-in or when it expires.",
    logoutClose: "Close",
    signedOutElsewhere:
      "Your sign-in is no longer valid, so this tab no longer shows the work. You continue the work when you sign in again.",
    signInAgain: "Sign in",
  },
  // FE-D3 (DAN-222): /prijava, Prijava v5 of the design handoff without the
  // e-mail sign-in and the "Što Ductura čuva" panel (D-09, #476). AAI@EduHr is
  // the one way in; nothing here describes what is recorded (the notice of
  // each assignment does, PRODUCT §5 rule 6).
  prijava: {
    // Archivum sign-in (owner's design package of 26 Oct 2026, DAN-344).
    title: "Sign in",
    back: "To the front page",
    // D-181: the reader is addressed with "Vi" (Codex P2 on #879, 6ea3ced8).
    eyebrow: "Your academic space",
    heading: "Welcome",
    headingMore: "to your",
    headingAccent: "space.",
    lead: "One way in for students and teachers.",
    leadMore: "Writing, feedback and conversation about the work.",
    paperMeta: `${APP_NAME} / academic work`,
    paperTitle: "Before the first",
    paperTitleAccent: "sentence.",
    paperNote: "Clear instructions. A connected conversation.",
    paperStudent: "The student writes.",
    paperTeacher: "The teacher guides.",
    cardEyebrow: "Sign in",
    cardTitle: "Your academic",
    cardTitleAccent: "identity.",
    cardBody: "Sign in with your AAI@EduHr account, the same one you use for Studomat and Merlin. Students and teachers use the same way in.",
    button: "Sign in with AAI@EduHr",
    passwordNote: "You enter your password only at AAI@EduHr.",
    roleTitle: "One way in. Your space.",
    roleBody: "After you sign in, your space opens according to your assigned role. The teacher role is confirmed by the faculty administrator.",
    codeSummary: "First visit, or do you have an assignment code?",
    codeNote: "First sign in with AAI@EduHr. You enter the assignment code from your teacher after signing in.",
    footer: "AAI@EduHr identity · access according to your assigned role",
    helpSummary: "Need help?",
    helpAaiTitle: "Cannot sign in with your AAI@EduHr account?",
    helpAaiBody: "For a forgotten username or password, contact the service desk of your home institution.",
    helpAaiLink: "Official AAI@EduHr help",
    helpAccessTitle: "Signed in, but no access?",
    helpAccessBody: "Contact the coordinator at your institution.",
  },
  // DAN-378 (M1.8): Z-03, a closed session behind the cookie; signed out,
  // with no session ever shown; Z-05, signed in without the role (UX pass
  // DAN-450, #1091 c.6561627758). Z-05 speaks of the own account only.
  access: {
    expiredTitle: "Session expired",
    expiredBody: "You were signed out because of inactivity. Sign in again and continue where you left off.",
    signedOutTitle: "You are not signed in.",
    signedOutBody: "Sign in to see {what}.",
    what: {
      courses: "your courses",
      newCourse: "the form for a new course and assignment",
      assignmentVersion: "the form for a new assignment version",
      fastPath: "the quick path through the works",
      mentoredWorks: "works you mentor",
      home: "your space",
      institution: "the overview of your institution",
      users: "the users of your institution",
      facultyRules: "the rules of your institution",
      institutionCourses: "the courses of your institution",
    },
    deniedTitle: "You do not have access to this view",
    deniedBody: "This view is intended for teachers.",
    deniedPending: "The teacher role is confirmed by the faculty administrator. Until it is confirmed, this view is not available.",
    deniedNext: "Contact the coordinator at your institution.",
    backToOwn: "Back to my space",
  },
  // DAN-591 (M2.11-P03, A-03): the institution's courses by academic year,
  // read only, as docs/design/ductura/m2-reference/a03-kolegiji-tim-i-grupe.html
  // writes them. Students are only counted, never named.
  institutionCourses: {
    title: "Courses and academic years",
    lead: "Your institution's courses by academic year, with the teaching team and seminar groups. Students' works and their content are not shown here.",
    yearHeading: "Academic year {year}",
    yearsLabel: "Academic years",
    enrolled: { one: "enrolled student", few: "enrolled students", many: "enrolled students" },
    students: { one: "student", few: "students", many: "students" },
    holder: "Course lead",
    team: "Teaching team",
    noHolder: "Not entered",
    noTeam: "No members",
    noGroups: "The course has no seminar groups.",
    groupTeacher: { one: "Teacher", many: "Teachers" },
    noTeacher: "No teacher",
    noTeacherNote: "Students in the group see the course and its assignments.",
    emptyYear: "The institution has no courses for this academic year.",
    noCourses: "The institution has no courses yet.",
    emptyNote: "A course is created by a teacher with a confirmed role; confirmation is under “Users and roles”.",
    unavailable: "Courses are not available right now. Try again.",
    retry: "Try again",
  },
  // DAN-590 (M2.12-P03, A-04): the faculty rule versions of DAN-315, read
  // only. The package of form rules (facultyRules below, M4) has no data yet
  // and is not shown. Purpose labels are short forms of tools.purposes.
  facultyRuleVersions: {
    title: "Faculty rules",
    lead: "The faculty's default rule for each type of work and all of its published versions. This screen is read-only. A published version does not change; a new version is added next to it.",
    currentHeading: "Rules in force",
    currentNote: "For each type of work the latest published version applies.",
    versionOf: "Version {n} · published {date}",
    aiPolicy: "AI assistance",
    policies: {
      prohibited: "Not allowed",
      partially_allowed: "Partly allowed",
      encouraged: "Encouraged",
    },
    purposes: "Allowed uses",
    purposeLabels: {
      formatting: "formatting",
      proofreading: "proofreading and language check",
      literature_search: "finding literature",
      transcription: "transcription",
      translation: "translation",
    },
    purposesNone: "None from the list",
    profile: "Record profile",
    profiles: { basic: "Basic", extended: "Extended" },
    importLabel: "Text import",
    importValues: { yes: "Allowed", no: "Not allowed" },
    origin: "Published by",
    origins: { operator: "Ductura team", administrator: "Institution administrator" },
    historyLabel: "Version history: {workType}",
    colVersion: "Version",
    colPublished: "Published",
    colOrigin: "Published by",
    colAi: "AI assistance",
    inForce: "{n} (in force)",
    notSetHeading: "No rule",
    notSetNote: "No faculty rule is set for these types of work:",
    empty: "The institution has no published faculty rules yet.",
    readOnly: "This screen only shows the rules. Publishing a new version is not available here.",
    unavailable: "Faculty rules are not available right now. Try again.",
    retry: "Try again",
  },
  // #732 item 3: Next.js error and not-found pages in Croatian (D-84).
  // M4 (DAN-506): A-04 "Pravila fakulteta", read-only (D-217), reference #1403.
  facultyRules: {
    title: "Faculty rules",
    intro: "The package of format rules the institution uses. This screen is read-only; a new version of the package is imported by the Ductura team.",
    visibleHeading: "What students and teachers see",
    colWorkType: "Type of work",
    colPanel: "Shown in the Instructions and format check panel",
    colCause: "Cause",
    shapeCheck: "Format check, package {version}",
    causeCovered: "The package covers this type of work.",
    causeNotCovered: "Package {version} does not cover this type of work.",
    notApplicable: "Does not apply to this type of work.",
    disabledHeading: "Not switched on for the whole institution",
    disabledSeen: "Students and teachers see: “The format check is not switched on at this institution right now. Submission is not limited because of this.”",
    disabledLicence: "The licence for the rule package has not been active since {date}.",
    disabledOther: "Other possible causes: the package has not been imported; the imported package is not valid.",
    packageHeading: "Rule package",
    version: "Version",
    imported: "Imported",
    publisher: "Publisher",
    coveredTypes: "Types of work covered",
    notCovered: "Not covered",
    ruleCount: "Number of rules",
    rulesHeading: "Rules and their full text",
    verbatim: "Verbatim citation · {source}",
    historyHeading: "Version history",
    historyVersion: "Version",
    historyImported: "Imported",
    historyCovered: "Types of work covered",
    inUse: "{version} (in use)",
    historyNote: "A work keeps the package version it was checked with; a new version does not change earlier checks.",
    adminHeading: "Settings edited by the administrator",
    adminNote: "The AI assistant rule, providers, thresholds and deadlines are not part of the rule package. They are edited separately, on the Institution settings screen.",
  },
  errorPage: {
    notFoundTitle: "Page not found",
    notFoundBody: "There is no page at this address. Check the address or go back to the home page.",
    errorTitle: "The page could not be shown",
    errorBody: "An unexpected error occurred. Try again; if it happens again, go back to the home page.",
  },
} as const satisfies Messages;

export const messagesEn: Messages = en;
