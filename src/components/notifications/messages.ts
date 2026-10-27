// The scanner reads all values from a messages module. Keep interface copy
// separate from the data the eventual server reader provides.
export const notificationMessages = {
  heading: "Obavijesti",
  studentLead: "Sve novosti vezane uz Vaše radove na jednom mjestu.",
  teacherLead: "Novosti na Vašim kolegijima i mentorstvima.",
  filter: "Prikaz obavijesti",
  all: "Sve",
  unread: "Nepročitane",
  new: "Novo",
  loadingTitle: "Učitavamo obavijesti.",
  loadingBody: "Pričekajte trenutak.",
  unavailableTitle: "Obavijesti trenutačno nisu dostupne.",
  unavailableBody: "Nije moguće utvrditi imate li novih obavijesti. Pokušajte ponovno poslije.",
  retry: "Pokušaj ponovno",
  emptyTitle: "Još nema obavijesti.",
  emptyBody: "Novosti vezane uz Vaše radove pojavit će se ovdje.",
  unreadEmptyTitle: "Nemate nepročitanih obavijesti.",
  unreadEmptyBody: "Sve ste obavijesti pregledali.",
  partialEmptyTitle: "U prikazanom dijelu nema obavijesti.",
  partialUnreadTitle: "U prikazanom dijelu nema nepročitanih obavijesti.",
  partialBody: "Prikazan je samo dio obavijesti.",
  showAll: "Prikaži sve obavijesti",
} as const;
