/**
 * Split floor groups into pages of at most `pageSize` captures.
 *
 *  - Small floors are packed together on a page and never split.
 *  - A floor with more captures than one page holds is split into consecutive pages of its own.
 *    (Before this, such a floor stayed whole on one page, so a floor with 100+ captures rendered every card at once.)
 *
 * Always returns at least one (possibly empty) page.
 */
export function paginateGroups<G extends { captures: readonly unknown[] }>(
  groups: readonly G[],
  pageSize: number,
): G[][] {
  const size = Math.max(1, Math.floor(pageSize));
  const pages: G[][] = [];
  let current: G[] = [];
  let currentCount = 0;

  for (const group of groups) {
    if (group.captures.length > size) {
      if (current.length > 0) {
        pages.push(current);
        current = [];
        currentCount = 0;
      }
      for (let i = 0; i < group.captures.length; i += size) {
        pages.push([{ ...group, captures: group.captures.slice(i, i + size) }]);
      }
      continue;
    }
    if (current.length > 0 && currentCount + group.captures.length > size) {
      pages.push(current);
      current = [];
      currentCount = 0;
    }
    current.push(group);
    currentCount += group.captures.length;
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}
