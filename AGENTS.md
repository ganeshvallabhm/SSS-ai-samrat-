<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep screen components in src/pages and thin file-based TanStack routes in src/routes; the router remains the single navigation authority.
- Keep typed mock records in src/data/mock.ts and all reads/mutations in src/api with a shared 500ms delay; no backend or browser persistence is used.
- Use TanStack Query route loaders and shared query options for mock snapshots; invalidate the snapshot after mutations so wallet, notifications and redemptions stay consistent.
