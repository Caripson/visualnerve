# Licensing and source distribution

Visual Nerve's original source code and associated documentation are licensed
under **Mozilla Public License 2.0 (MPL-2.0)** from the license-change revision
onward. The unmodified license text is in [LICENSE](../LICENSE). [NOTICE](../NOTICE)
contains the MPL source notice, copyright attribution and scope. That notice
applies at repository level; files carrying third-party terms keep those terms.
The project does not apply Exhibit B's incompatibility notice.

MPL's requirements apply to covered source files. Distributed modifications of
those files remain under MPL; independent files in a larger work may have other
licenses. Commercial use is permitted. These summaries do not replace the
[license](https://www.mozilla.org/en-US/MPL/2.0/) or
[Mozilla's FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

## Source availability and distribution

The [source repository](https://github.com/Caripson/visualnerve) became public on
2026-10-08, separately from the license change. Source revisions, the license and
notices are available there. `frontend/package.json` remains `private: true` to
prevent npm publication; it does not make the GitHub repository private. Private
development and internal use do not require public source publication.

Distribution is a separate matter. Browser JavaScript sent to users, including
minified code, is executable distribution under MPL (see FAQ Q16–17). Before
deploying this MPL-covered version or otherwise delivering it to recipients:

- Make the corresponding MPL-covered source available to those recipients by
  reasonable means in a timely manner, under MPL-2.0.
- Tell them how to obtain it. A GitHub link to a private repository they cannot
  access does not meet that requirement. The public repository is the current
  source route; retain the matching revision for each build. A matching source
  archive or authorized recipient access is another option.
- Include the license and copyright notices, and keep third-party notices and
  source obligations intact.

Production deployment remains manual. The build copies the project's full
license and notice to `/licenses/visualnerve-LICENSE` and
`/licenses/visualnerve-NOTICE`; `/license/` explains the terms. These notices
alone are not a source-code offer or proof that all distribution duties are met.

## Third-party material

[DEPENDENCIES.md](../DEPENDENCIES.md) and
[docs/third-party-licenses.json](third-party-licenses.json) identify dependencies
and retained notices. `scripts/licenses.mjs` regenerates that inventory and
copies license texts into the static build without replacing upstream terms.

The Piper Web reference material adapted by the speech engine retains its MIT
attribution. Voice models and their training sources have separate terms. The
distributed Piper/eSpeak runtime contains GPL-3.0-or-later material; its source
and build references are in [SPEECH.md](SPEECH.md) and the runtime notices. MPL
does not waive its obligations. The integration's combined-work status and the
completeness of corresponding source require a separate distribution review;
this license change makes no claim that every bundled component is MPL or that
the complete application is available for closed-source distribution.

## Earlier versions

Permissions already granted for previously distributed MIT copies remain in
effect. Historical revisions preserve their original license text. The new
license does not retroactively revoke MIT permissions.
