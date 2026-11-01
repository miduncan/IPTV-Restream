# Issue tracker: GitHub

Issues and specs live in miduncan/IPTV-Restream.
Use gh with --repo miduncan/IPTV-Restream explicitly;
this fork's upstream is not the target.

## Operations

- Publish: create a GitHub issue.
- Read: gh issue view <number> --repo miduncan/IPTV-Restream
- List: gh issue list --repo miduncan/IPTV-Restream
- Create: gh issue create --repo miduncan/IPTV-Restream
  --title "..." --body-file <file>
- Comment: gh issue comment <number>
  --repo miduncan/IPTV-Restream --body-file <file>
- Labels: gh issue edit <number>
  --repo miduncan/IPTV-Restream --add-label <label>
- Close: post an explanation, then close the issue.

Use native sub-issues and blocking dependencies when supported.
Otherwise record Part of #<parent> and Blocked by: #<number>
in issue bodies, with a child task list in the parent.

For wayfinding, use a parent issue labeled wayfinder:map and
child issues labeled wayfinder:<type>. Claim an unassigned,
unblocked child before work; record its resolution in the parent.

PRs as a request surface: no.
