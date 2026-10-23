import { redirect } from "next/navigation";

// FE-D10: the teacher's course and assignment screen lives at
// /nastavnik/zadatak/novi (design INTEGRACIJA §1). Old links and login
// returnTo values still arrive here, so this route only forwards.
export default function TeacherCoursesRedirect(): never {
  redirect("/nastavnik/zadatak/novi");
}
