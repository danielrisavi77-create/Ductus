import { redirect } from "next/navigation";

// Z3 (A): the teacher's entry is /nastavnik, the list of their courses. Old
// links and login returnTo values still arrive here, so this route only forwards.
export default function TeacherCoursesRedirect(): never {
  redirect("/nastavnik");
}
