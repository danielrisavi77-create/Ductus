import { pluralHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { CoursePerson, InstitutionCourse, InstitutionGroup } from "@/server/institution/institution-courses";

import styles from "./InstitutionCourses.module.css";
import { yearHref, yearLabel } from "./institution-courses-view";
import { displayName } from "./teacher-roles-view";

const t = messagesHr.institutionCourses;

const count = (n: number, forms: { one: string; few: string; many: string }) =>
  `${n} ${pluralHr(n, forms.one, forms.few, forms.many)}`;
const names = (people: readonly CoursePerson[]) => people.map((p) => displayName(p.name)).join(", ");

function Group({ group }: { group: InstitutionGroup }) {
  const label = group.teachers.length === 1 ? t.groupTeacher.one : t.groupTeacher.many;
  return (
    <div className={styles.group}>
      <h4>{group.name}</h4>
      {group.teachers.length === 0
        ? <p className={styles.flag}><strong>{t.noTeacher}</strong><span>{t.noTeacherNote}</span></p>
        : <p>{label}: {names(group.teachers)}</p>}
      <p className={styles.meta}>{count(group.students, t.students)}</p>
    </div>
  );
}

function Course({ course }: { course: InstitutionCourse }) {
  const headingId = `kolegij-${course.courseId}`;
  return (
    <article className={styles.course} aria-labelledby={headingId}>
      <div className={styles.courseHead}>
        <h3 id={headingId}>{course.name}</h3>
        <span className={styles.chip}>{count(course.students, t.enrolled)}</span>
      </div>
      <dl className={styles.kv}>
        <dt>{t.holder}</dt><dd>{course.holder === null ? t.noHolder : displayName(course.holder.name)}</dd>
        <dt>{t.team}</dt><dd>{course.team.length === 0 ? t.noTeam : names(course.team)}</dd>
      </dl>
      {course.groups.length === 0
        ? <p className={styles.meta}>{t.noGroups}</p>
        : <div className={styles.groups}>{course.groups.map((g) => <Group key={g.groupId} group={g} />)}</div>}
    </article>
  );
}

/**
 * DAN-591 (A-03, docs/design/ductura/m2-reference/a03-kolegiji-tim-i-grupe.html):
 * the courses of one academic year with their holder, team and groups, read
 * only. Students are counted, never named. The assignment of group teachers
 * (states 3 and 4 of the reference) has no administrator route on main yet
 * and is not shown (contract #1091 c.6708627828).
 */
export default function InstitutionCourses({ href, years, year, courses }: {
  href: string; years: readonly string[]; year: string | null; courses: readonly InstitutionCourse[];
}) {
  if (year === null) {
    return (
      <div className={styles.card}>
        <p>{t.noCourses}</p>
        <p className={styles.meta}>{t.emptyNote}</p>
      </div>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="akademska-godina">
      <h2 id="akademska-godina">{t.yearHeading.replace("{year}", yearLabel(year))}</h2>
      <nav aria-label={t.yearsLabel}>
        <ul className={styles.years}>
          {years.map((y) => (
            <li key={y}>
              <a className={y === year ? styles.yearCurrent : styles.year} href={yearHref(href, y)}
                aria-current={y === year ? "page" : undefined}>{yearLabel(y)}</a>
            </li>
          ))}
        </ul>
      </nav>
      {courses.length === 0
        ? <div className={styles.card}><p>{t.emptyYear}</p><p className={styles.meta}>{t.emptyNote}</p></div>
        : courses.map((course) => <Course key={course.courseId} course={course} />)}
    </section>
  );
}
