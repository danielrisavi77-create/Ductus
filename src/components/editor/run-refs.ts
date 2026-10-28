/**
 * The end of one lock run in `LocalDocumentProvider` (F-125 t. 2): the refs
 * are shared by every run of the effect, so a run stops its own publisher and
 * clears a ref only while it still holds this run's own value.
 */

type Ref<T> = { current: T | null };

export function endRun<P extends { stop(): void }, L>(
  refs: { publisher: Ref<P>; logout: Ref<L> },
  own: { publisher: P | null; logout: L | null },
): void {
  own.publisher?.stop();
  if (own.publisher !== null && refs.publisher.current === own.publisher) refs.publisher.current = null;
  if (own.logout !== null && refs.logout.current === own.logout) refs.logout.current = null;
}
