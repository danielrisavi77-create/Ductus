import { zagrebParts } from "@/components/summary/zagreb-time";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { FacultyRuleVersion, FacultyRules as Rules } from "@/server/institution/faculty-rules";

import styles from "./FacultyRules.module.css";

const t = messagesHr.facultyRuleVersions;
const workTypes = messagesHr.teacher.assignment.workTypes;

/** A fixed Europe/Zagreb date, so the server and the browser render the same text. */
const dateOf = (iso: string) => zagrebParts(iso)?.date ?? "";

function purposesOf(version: FacultyRuleVersion): string {
  if (version.aiPurposes.length === 0) return t.purposesNone;
  return version.aiPurposes.map((purpose) => t.purposeLabels[purpose]).join(", ");
}

/**
 * DAN-590 (A-04, docs/design/ductura/m4-reference/a04-pravila-fakulteta.html):
 * the rule in force for each work type and every published version, with no
 * action. Only what faculty_rule_version holds; the package of form rules in
 * the reference has no data yet and is not shown (contract on #1091).
 */
export default function FacultyRules({ rules }: { rules: Rules }) {
  const set = rules.filter((rule) => rule.versions.length > 0);
  const notSet = rules.filter((rule) => rule.versions.length === 0);
  return (
    <>
      <section className={styles.section} aria-labelledby="pravila-na-snazi">
        <h2 id="pravila-na-snazi">{t.currentHeading}</h2>
        {set.length === 0 ? <p className={styles.note}>{t.empty}</p> : <p className={styles.note}>{t.currentNote}</p>}
        {set.map(({ workType, versions }) => {
          const current = versions[versions.length - 1]!;
          const headingId = `pravilo-${workType}`;
          return (
            <article key={workType} className={styles.card} aria-labelledby={headingId}>
              <header className={styles.cardHead}>
                <h3 id={headingId}>{workTypes[workType]}</h3>
                <p className={styles.meta}>
                  {t.versionOf.replace("{n}", String(current.versionNo)).replace("{date}", dateOf(current.publishedAt))}
                </p>
              </header>
              <dl className={styles.kv}>
                <dt>{t.aiPolicy}</dt><dd>{t.policies[current.aiPolicy]}</dd>
                <dt>{t.purposes}</dt><dd>{purposesOf(current)}</dd>
                <dt>{t.profile}</dt><dd>{t.profiles[current.evidenceProfile]}</dd>
                <dt>{t.importLabel}</dt><dd>{current.importAllowed ? t.importValues.yes : t.importValues.no}</dd>
                <dt>{t.origin}</dt><dd>{t.origins[current.origin]}</dd>
              </dl>
              <table className={styles.history} aria-label={t.historyLabel.replace("{workType}", workTypes[workType])}>
                <thead>
                  <tr><th scope="col">{t.colVersion}</th><th scope="col">{t.colPublished}</th>
                    <th scope="col">{t.colOrigin}</th><th scope="col">{t.colAi}</th></tr>
                </thead>
                <tbody>
                  {[...versions].reverse().map((version) => (
                    <tr key={version.versionNo}>
                      <td>{version === current ? t.inForce.replace("{n}", String(version.versionNo)) : version.versionNo}</td>
                      <td>{dateOf(version.publishedAt)}</td>
                      <td>{t.origins[version.origin]}</td>
                      <td>{t.policies[version.aiPolicy]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          );
        })}
      </section>
      {notSet.length > 0 && set.length > 0 ? (
        <section className={styles.section} aria-labelledby="bez-pravila">
          <h2 id="bez-pravila">{t.notSetHeading}</h2>
          <p className={styles.note}>{t.notSetNote}</p>
          <ul className={styles.list}>
            {notSet.map(({ workType }) => <li key={workType}>{workTypes[workType]}</li>)}
          </ul>
        </section>
      ) : null}
      <p className={styles.readOnly}>{t.readOnly}</p>
    </>
  );
}
